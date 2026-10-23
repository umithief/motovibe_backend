import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { signAccessToken } from '../modules/auth/service.js';
import { fetchLeaderboard } from '../modules/leaderboards/service.js';

const id=n=>new mongoose.Types.ObjectId(n.toString(16).padStart(24,'0'));
const fake=value=>{const query={then:(resolve,reject)=>Promise.resolve(value).then(resolve,reject)};for(const method of ['sort','select','lean','limit','populate'])query[method]=()=>query;return query;};
const field=(row,key)=>key.split('.').reduce((value,part)=>value?.[part],row);
const scalar=value=>String(value?._id || value);
const matches=(row,filter)=>Object.entries(filter).every(([key,rule])=>{
    if(key==='$or')return rule.some(child=>matches(row,child));
    if(key==='$and')return rule.every(child=>matches(row,child));
    const value=field(row,key);
    if(rule===null)return value==null;
    if(rule instanceof RegExp)return rule.test(String(value ?? ''));
    if(rule && typeof rule==='object' && !(rule instanceof mongoose.Types.ObjectId) && !(rule instanceof Date))return Object.entries(rule).every(([op,expected])=>{
        if(op==='$in')return expected.some(item=>scalar(item)===scalar(value ?? null));
        if(op==='$nin')return !expected.some(item=>scalar(item)===scalar(value));
        if(op==='$ne')return value!==expected;
        if(op==='$gt')return value>expected;
        if(op==='$gte')return value>=expected;
        if(op==='$exists')return (value!==undefined)===expected;
        if(op==='$not')return !matches({value},{value:expected});
        if(op==='$size')return Array.isArray(value) && value.length===expected;
        throw Error('Unimplemented test query operator: '+op);
    });
    return scalar(value)===scalar(rule);
});
const listen=async()=>{const server=http.createServer(createApp());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,base:'http://127.0.0.1:'+server.address().port};};
const close=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};

test('discover, legacy search and trending exclude private/deleted/unapproved content and blocked authors through HTTP',async()=>{
    const previous=process.env.JWT_SECRET;process.env.JWT_SECRET='audit-contract-key-at-least-32-characters';
    const viewer={_id:id(90),tokenVersion:0,blockedUsers:[id(92)],following:[]};
    const author=id(91);const now=new Date();
    const posts=['PUBLIC',undefined,'PRIVATE','FOLLOWERS','DELETED','PUBLIC','PUBLIC'].map((visibility,index)=>({_id:id(index+1),user:index===6?id(92):author,caption:'motor',content:'motor',visibility,isDeleted:index===5,createdAt:now,media:[{url:'uploads/post.png'}],userName:'Rider'}));
    const reels=Array.from({length:5},(_,index)=>({_id:id(index+21),userId:index===4?id(92):author,caption:'motor',createdAt:now,isApproved:index!==2,isPublic:index!==1,isDeleted:index===3,videoUrl:'uploads/reel.mp4'}));
    const datasets={SocialPost:posts,Reel:reels,User:[],Pack:[],Route:[],Tag:[]};
    const originals=[];let runtime;
    for(const name of [...Object.keys(datasets),'VibeConfig']){
        const Model=mongoose.model(name);for(const method of ['find','findById','aggregate','countDocuments'])originals.push([Model,method,Model[method]]);
        Model.find=filter=>{const query=new mongoose.Query(filter,{},Model);query.exec=async()=>datasets[name].filter(row=>matches(row,query.getFilter())).slice(query.options.skip || 0,(query.options.skip || 0)+(query.options.limit || 100));return query;};
        Model.aggregate=()=>fake([]);Model.countDocuments=()=>fake(0);
        Model.findById=()=>fake(name==='User'?{...viewer}:name==='VibeConfig'?new Model({_id:'default_config'}):null);
    }
    try {
        runtime=await listen();const token=signAccessToken(viewer);
        for(const authenticated of [false,true]){
            const headers=authenticated?{authorization:'Bearer '+token}:{};
            for(const path of ['/api/explore/search?q=motor','/api/explore/trending','/api/posts/discover']){
                const response=await fetch(runtime.base+path,{headers});assert.equal(response.status,200,path);
                const body=await response.json();let result;
                if(path.includes('/search')){assert.ok(Array.isArray(body.riders));result=[...body.posts,...body.reels];}
                else if(path.endsWith('/trending')){assert.ok(Array.isArray(body.items));result=body.items;}
                else {assert.equal(body.status,'success');result=body.data.items;}
                const returned=result.map(item=>String(item._id).replace(/^re:/,''));
                for(const hidden of [3,4,5,6,22,23,24])assert.equal(returned.includes(String(id(hidden))),false,path+' hides '+hidden);
                for(const publicId of [1,2])assert.equal(returned.includes(String(id(publicId))),true,path+' retains '+publicId);
                assert.equal(returned.includes(String(id(7))),!authenticated,path+' blocked owner');
                if(!path.endsWith('/trending'))assert.equal(returned.includes(String(id(25))),!authenticated,path+' blocked reel owner');
            }
        }
    } finally {if(runtime)await close(runtime.server);for(const [Model,method,original]of originals)Model[method]=original;if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
});

test('private Ride reads and deletes authorize canonical user and legacy userId owners through HTTP',async()=>{
    const previous=process.env.JWT_SECRET;process.env.JWT_SECRET='audit-ride-key-at-least-32-characters';
    const User=mongoose.model('User'),Ride=mongoose.model('Ride');const viewer={_id:id(50),tokenVersion:0};
    const records=[{_id:id(51),user:viewer._id,isPublic:false},{_id:id(52),userId:viewer._id,isPublic:false},{_id:id(53),user:id(54),isPublic:false},{_id:id(55),user:id(54),userId:viewer._id,isPublic:false}];
    const originals=[[User,'findById',User.findById],[Ride,'findById',Ride.findById],[Ride,'findOneAndDelete',Ride.findOneAndDelete]];let runtime;
    User.findById=()=>fake({...viewer});Ride.findById=key=>fake(records.find(row=>scalar(row._id)===scalar(key)));
    Ride.findOneAndDelete=async filter=>{const index=records.findIndex(row=>matches(row,filter));return index===-1?null:records.splice(index,1)[0];};
    try {
        runtime=await listen();const headers={authorization:'Bearer '+signAccessToken(viewer)};
        for(const owned of [51,52]){
            const path=runtime.base+'/api/rides/'+id(owned);const read=await fetch(path,{headers});assert.equal(read.status,200);assert.equal((await read.json()).data._id,String(id(owned)));
            const removed=await fetch(path,{method:'DELETE',headers});assert.equal(removed.status,200);assert.equal((await removed.json()).success,true);
        }
        for(const foreignId of [53,55]){
            const foreign=runtime.base+'/api/rides/'+id(foreignId);assert.equal((await fetch(foreign,{headers})).status,403);
            const removed=await fetch(foreign,{method:'DELETE',headers});assert.equal(removed.status,404);assert.equal((await removed.json()).success,false);
        }
        assert.equal(records.length,2);assert.equal(scalar(records[0]._id),String(id(53)));
    } finally {if(runtime)await close(runtime.server);for(const [Model,method,original]of originals)Model[method]=original;if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
});

test('Mongo leaderboard fallback groups canonical and legacy Ride owners without splitting or misattributing scores',async()=>{
    const Ride=mongoose.model('Ride'),User=mongoose.model('User'),Pack=mongoose.model('Pack');
    const owners=[id(70),id(71)];const now=new Date();
    const records=[{user:owners[0],createdAt:now,stats:{totalDistance:2,maxLeanAngle:10}},{userId:owners[1],createdAt:now,stats:{totalDistance:3,maxLeanAngle:30}},{user:owners[0],userId:owners[1],createdAt:now,stats:{totalDistance:5,maxLeanAngle:20}}];
    const originals=[[Ride,'aggregate',Ride.aggregate],[User,'find',User.find],[Pack,'find',Pack.find]];
    User.find=()=>fake(owners.map((_id,index)=>({_id,name:'Rider '+index})));
    Pack.find=()=>fake(owners.map((owner,index)=>({_id:id(index+80),members:[owner],name:'Pack '+index})));
    const evaluate=(row,expression)=>typeof expression==='string'?field(row,expression.slice(1)):expression.$ifNull.map(part=>evaluate(row,part)).find(value=>value!=null);
    Ride.aggregate=async pipeline=>{
        const selected=records.filter(row=>matches(row,pipeline.find(stage=>stage.$match).$match));const group=pipeline.find(stage=>stage.$group).$group;const grouped=new Map();
        for(const row of selected){const owner=evaluate(row,group._id);const entry=grouped.get(String(owner)) || {_id:owner};
            for(const [name,expression]of Object.entries(group)){if(name==='_id')continue;const [operator,path]=Object.entries(expression)[0];const value=evaluate(row,path);entry[name]=operator==='$sum'?(entry[name] || 0)+value:Math.max(entry[name] || 0,value);}
            grouped.set(String(owner),entry);
        }
        const sort=pipeline.find(stage=>stage.$sort)?.$sort;const values=[...grouped.values()];if(sort){const key=Object.keys(sort)[0];values.sort((a,b)=>b[key]-a[key]);}return values;
    };
    try {
        const distance=await fetchLeaderboard({category:'weekly_distance'});assert.deepEqual(distance.entries.map(entry=>[entry.id,entry.score]),[[String(owners[0]),7],[String(owners[1]),3]]);
        const lean=await fetchLeaderboard({category:'max_lean_angle'});assert.deepEqual(lean.entries.map(entry=>[entry.id,entry.score]),[[String(owners[1]),30],[String(owners[0]),20]]);
        const packs=await fetchLeaderboard({category:'weekly_pack_distance'});assert.deepEqual(packs.entries.map(entry=>entry.score),[7,3]);
    } finally {for(const [Model,method,original]of originals)Model[method]=original;}
});
