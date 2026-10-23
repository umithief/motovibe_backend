import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import http from 'node:http';
import fs from 'node:fs';
import { createApp } from '../app.js';
import { signAccessToken } from '../modules/auth/service.js';
import { responseEnvelope } from '../utils/respond.js';
import { buildHomeSummary } from '../modules/home/service.js';
import { calculateVibeScore } from '../modules/discovery/ranking.service.js';
import { calculateTelemetryFeaturedScore,calculateRouteFeaturedScore,rankAndInterleaveTrending } from '../modules/discovery/service.js';
import { migrateGroupRides } from '../scripts/migrate-group-rides.mjs';
const fake=value=>{const q={then:(r,j)=>Promise.resolve(value).then(r,j)};for(const m of ['select','lean','sort','limit','populate'])q[m]=()=>q;return q;};

test('the fifth explicit user error preserves the PRO gate on legacy and canonical HTTP paths',async()=>{
    const prior=process.env.JWT_SECRET;process.env.JWT_SECRET='final-pro-gate-key-at-least-32-characters';
    const User=mongoose.model('User'),Route=mongoose.model('Route'),old=[User.findById,Route.find];
    const viewer={_id:new mongoose.Types.ObjectId(),tokenVersion:0,isPro:false};User.findById=()=>fake({...viewer});Route.find=()=>fake([]);
    const server=http.createServer(createApp());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
    try {
        const options={method:'PATCH',headers:{authorization:'Bearer '+signAccessToken(viewer),'content-type':'application/json'},body:JSON.stringify({bioBlocks:[{type:'STAT'}]})};
        for(const prefix of ['/api','/api/v2']){const result=await fetch(base+prefix+'/users/profile',options);assert.equal(result.status,403);const body=await result.json();
            if(prefix==='/api'){assert.equal(body.status,'fail');assert.equal(body.requiresPro,true);assert.deepEqual(Object.keys(body).sort(),['message','requiresPro','status']);}
            else {assert.equal(body.status,'error');assert.equal(body.data,null);assert.equal(body.meta.requiresPro,true);assert.match(body.error.message,/PRO/);}}
        const redirect=await fetch(base+'/api/v2/social/discover?q=motor',{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/api/v2/posts/discover?q=motor');
    }finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));[User.findById,Route.find]=old;if(prior===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=prior;}
});

test('canonical responses normalize boolean envelopes and text errors without character-index fields',()=>{
    assert.deepEqual(responseEnvelope({success:true,data:[1]}),{status:'success',data:[1]});
    const items=[{id:'a'}];assert.deepEqual(responseEnvelope({status:'success',items,data:{items}}),{status:'success',data:{items}});
    assert.deepEqual(responseEnvelope({status:'success',count:3,data:{count:3}}),{status:'success',data:{count:3}});
    assert.deepEqual(responseEnvelope({status:'success',bioBlocks:[],isLocked:true}),{status:'success',data:{bioBlocks:[],isLocked:true}});
    assert.deepEqual(responseEnvelope({error:'Sürüş bulunamadı.'},404),{status:'error',data:null,error:{message:'Sürüş bulunamadı.'}});
});

test('home featured-route query errors propagate unchanged through the service and cache',async()=>{
    const names=['Route','GroupRide','SocialPost','Slide','Campaign','VibeConfig'];const restored=[];
    const failure=Error('query unavailable');
    for(const name of names){const Model=mongoose.model(name);for(const method of ['find','findOne','findById','countDocuments','getActiveSlides']){restored.push([Model,method,Model[method]]);Model[method]=()=>fake(method==='countDocuments'?0:method==='find'?[]:null);}}
    mongoose.model('Route').findOne=()=>({lean:()=>Promise.reject(failure)});
    try {await assert.rejects(buildHomeSummary({cache:{get:async(key,load)=>load()}}),error=>error===failure);}
    finally {for(const [Model,method,value]of restored)if(value===undefined)delete Model[method];else Model[method]=value;}
});

test('legacy trending projection uses the same discovery score engine and keeps Flutter fields',()=>{
    const post={_id:'p',likes:[],media:[{url:'uploads/post.png'}],user:{name:'Pilot',avatar:'uploads/avatar.png'},caption:'Viraj',telemetry:{speed:50}};
    const route={_id:'r',title:'Rota',image:'uploads/route.png',riderCount:5,rating:4};
    assert.equal(calculateTelemetryFeaturedScore(post),calculateVibeScore(post,'post'));
    assert.equal(calculateRouteFeaturedScore(route),calculateVibeScore(route,'route'));
    const items=rankAndInterleaveTrending([post],[route]);assert.deepEqual(items.map(item=>item.type),['post','route']);assert.equal(items[0].userName,'Pilot');assert.equal(items[0].imageUrl,'uploads/post.png');assert.equal(items[1].title,'Rota');
    const application=fs.readFileSync(new URL('../modules/discovery/application.service.js',import.meta.url),'utf8');assert.doesNotMatch(application,/\b(?:SocialPost|Post|Reel|Route)\.(?:find|aggregate|countDocuments)\(/);
});

test('group migration dry-run validates legacy rows and apply is idempotent without legacy writes',async()=>{
    const id=n=>new mongoose.Types.ObjectId(n.toString(16).padStart(24,'0'));
    const valid={_id:id(1),title:'Ride',date:'2026-10-12',time:'08:00',meetingPoint:'Start',organizer:{userId:id(99)}};
    const rows=[valid,{...valid,_id:id(2),date:'bad'},{...valid,_id:id(3)}];const canonicalRows=new Map([[String(id(3)),{_id:id(3),kind:'solo'}]]);let writes=0;
    const legacy={find:()=>({batchSize:()=>({async *[Symbol.asyncIterator](){yield*rows;}})})};
    const canonical={findOne:async filter=>canonicalRows.get(String(filter._id)),updateOne:async(filter,update)=>{writes++;canonicalRows.set(String(filter._id),update.$setOnInsert);return {upsertedCount:1};}};
    const dry=await migrateGroupRides({legacy,canonical});assert.equal(dry.pending,1);assert.equal(dry.invalid,1);assert.equal(dry.collisions,1);assert.equal(writes,0);
    const apply=await migrateGroupRides({legacy,canonical,apply:true});assert.equal(apply.promoted,1);assert.equal(writes,1);assert.equal(canonicalRows.get(String(id(1))).kind,'group');
    const again=await migrateGroupRides({legacy,canonical,apply:true});assert.equal(again.promoted,0);assert.equal(again.existing,1);assert.equal(writes,1);
});

test('centralized legacy flat errors preserve their string error field while v2 exposes the canonical error object',async()=>{
    const GroupRide=mongoose.model('GroupRide'),old=GroupRide.findById;GroupRide.findById=()=>fake(null);
    const server=http.createServer(createApp());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
    try {
        const path='/rides/group-rides/000000000000000000000001';
        const legacy=await fetch(base+'/api'+path);assert.equal(legacy.status,404);assert.deepEqual(await legacy.json(),{success:false,error:'Sürüş etkinliği bulunamadı.'});
        const canonical=await fetch(base+'/api/v2'+path);assert.equal(canonical.status,404);const body=await canonical.json();assert.equal(body.status,'error');assert.equal(body.data,null);assert.deepEqual(body.error,{message:'Sürüş etkinliği bulunamadı.'});
    }finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));GroupRide.findById=old;}
});
