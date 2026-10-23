import crypto from 'node:crypto';
import mongoose from 'mongoose';
import AppError from '../../utils/appError.js';
import { getJwtSecret } from '../../config/env.js';
const invalid=()=>{const error=new AppError('Geçersiz veya süresi dolmuş cursor.',400);error.code='INVALID_CURSOR';return error;};
const signature=encoded=>crypto.createHmac('sha256',getJwtSecret()).update(encoded).digest('base64url');
export const discoveryCursorScope = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const readDiscoveryCursor = (token,scope,now=Date.now()) => {
    if(token==='start')return {v:1,scope,snapshot:new Date(now).toISOString(),page:1,anchors:{},done:{},expires:now+3600000};
    if(typeof token!=='string' || token.length>4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw invalid();
    const [encoded,mac]=token.split('.');const expected=signature(encoded);
    if(mac.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw invalid();
    let value;try{value=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw invalid();}
    if(value.v!==1 || value.scope!==scope || !Number.isSafeInteger(value.page) || value.page<1 || value.page>10000 || !Number.isFinite(value.expires) || value.expires<=now || value.expires>now+3600000 || Number.isNaN(Date.parse(value.snapshot)) || Date.parse(value.snapshot)>now+5000 || !value.anchors || !value.done)throw invalid();
    for(const [source,anchor]of Object.entries(value.anchors))if(!['posts','reels','routes'].includes(source) || !anchor || !/^[a-f0-9]{24}$/i.test(anchor.id) || Number.isNaN(Date.parse(anchor.createdAt)))throw invalid();
    return value;
};
export const pageDiscoveryQuery = (query,cursor,source,offset) => {
    if(!cursor)return query.skip(offset);
    const conditions=[query.getFilter(),{createdAt:{$lte:new Date(cursor.snapshot)}}];
    if(cursor.done[source])conditions.push({_id:{$exists:false}});
    const anchor=cursor.anchors[source];
    if(anchor)conditions.push({$or:[{createdAt:{$lt:new Date(anchor.createdAt)}},{createdAt:new Date(anchor.createdAt),_id:{$lt:new mongoose.Types.ObjectId(anchor.id)}}]});
    query.setQuery({$and:conditions});
    query.setOptions({sort:{createdAt:-1,_id:-1},skip:0});
    return query;
};
export const nextDiscoveryCursor = (cursor,window,raw,trimmed,hasMore) => {
    if(!cursor || !hasMore)return null;
    const next={...cursor,page:cursor.page+1,anchors:{...cursor.anchors},done:{...cursor.done}};
    for(const source of ['posts','reels','routes']) {
        const size=window[source==='posts' ? 'postSize' : source==='reels' ? 'reelSize' : 'routeSize'];
        const rows=trimmed[source];
        if(rows.length){const tail=rows.at(-1);next.anchors[source]={id:String(tail._id),createdAt:new Date(tail.createdAt).toISOString()};}
        if(size===0 || raw[source].length<=size)next.done[source]=true;
    }
    const encoded=Buffer.from(JSON.stringify(next)).toString('base64url');
    return encoded+'.'+signature(encoded);
};
