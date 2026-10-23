import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createSummaryCache } from '../modules/home/cache.service.js';
import { buildHomeSummary } from '../modules/home/service.js';
import { buildDiscoveryPage } from '../modules/discovery/feed.service.js';
import { readDiscoveryCursor,nextDiscoveryCursor,pageDiscoveryQuery } from '../modules/discovery/cursor.service.js';
import { registerUnsupportedChatEvents } from '../modules/messages/socket.js';
import { lazyRouter } from '../utils/lazyModule.js';
import '../modules/events/model.js';

const fake=value=>{const q={then:(r,j)=>Promise.resolve(value).then(r,j)};for(const m of ['sort','lean','select','limit','populate'])q[m]=()=>q;return q;};
test('home cache coalesces concurrent misses, expires, and survives Redis failure',async()=>{
    let now=1000,loads=0;const client={get:async()=>{throw Error('offline');},set:async()=>{throw Error('offline');}};
    const cache=createSummaryCache({client,ttlMs:30,now:()=>now});
    const load=async()=>{loads++;await Promise.resolve();return {count:loads};};
    const result=await Promise.all([cache.get('public',load),cache.get('public',load),cache.get('public',load)]);
    assert.equal(loads,1);assert.equal(result[0],result[1]);now+=31;
    assert.deepEqual(await cache.get('public',load),{count:2});
    let attempts=0;
    await assert.rejects(cache.get('broken',async()=>{attempts++;throw Error('mongo unavailable');}));
    await assert.rejects(cache.get('broken',async()=>{attempts++;throw Error('mongo unavailable');}));
    assert.equal(attempts,2);
});
test('a shared Redis entry cannot have its public-data TTL extended by another process',async()=>{
    let now=1029,loads=0;const client={get:async()=>JSON.stringify({data:{old:true},expires:1030}),set:async()=>null};
    const cache=createSummaryCache({client,ttlMs:30,now:()=>now});
    assert.deepEqual(await cache.get('public',async()=>{loads++;return {old:false};}),{old:true});
    now=1031;
    assert.deepEqual(await cache.get('public',async()=>{loads++;return {old:false};}),{old:false});assert.equal(loads,1);
});
test('cached public home data never shares joinedRide or isJoined between two users',async()=>{
    const GroupRide=mongoose.model('GroupRide');const original=GroupRide.findOne;
    const alice=new mongoose.Types.ObjectId(),bob=new mongoose.Types.ObjectId();
    const ride={_id:new mongoose.Types.ObjectId(),organizer:{userId:alice},participants:[]};
    let publicLoads=0,privateReads=0;let shared;
    const cache={get:async()=>{publicLoads++;return shared ||= [8,3,{title:'route'},null,[],[],{config:{showcaseEnabled:true}}];}};
    GroupRide.findOne=filter=>{if(filter.$and){privateReads++;return fake(filter.$and[1].$or[0]['participants.userId']===alice ? ride : null);}return fake(ride);};
    try {
        const a=await buildHomeSummary({user:{_id:alice},cache});const b=await buildHomeSummary({user:{_id:bob},cache});
        assert.equal(a.upcomingRide.isJoined,true);assert.equal(b.upcomingRide.isJoined,false);
        assert.equal(a.joinedRide.isJoined,true);assert.equal(b.joinedRide,null);
        assert.equal(a.showcaseEnabled,false);assert.equal(privateReads,2);assert.equal(publicLoads,2);
        assert.equal(ride.isJoined,undefined);
    }finally{GroupRide.findOne=original;}
});
test('cursor signature, viewer scope, expiry and malformed input are checked before querying',()=>{
    const previous=process.env.JWT_SECRET;process.env.JWT_SECRET='cursor-regression-test-key-at-least-32-characters';
    try {
        const cursor=readDiscoveryCursor('start','viewer-a',1000);
        const id=new mongoose.Types.ObjectId();const rows={posts:[{_id:id,createdAt:new Date(900)}],reels:[],routes:[]};
        const token=nextDiscoveryCursor(cursor,{postSize:1,reelSize:0,routeSize:0},{...rows,posts:[...rows.posts,{}]},rows,true);
        assert.equal(readDiscoveryCursor(token,'viewer-a',1001).anchors.posts.id,String(id));
        assert.throws(()=>readDiscoveryCursor(token,'viewer-b',1001));
        assert.throws(()=>readDiscoveryCursor(token,'viewer-a',3601001));
        assert.throws(()=>readDiscoveryCursor(token.slice(0,-1)+(token.endsWith('a')?'b':'a'),'viewer-a',1001));
        for(const invalid of ['',{},'x'.repeat(5000),'a.b'])assert.throws(()=>readDiscoveryCursor(invalid,'viewer-a',1001));
        const Model=mongoose.model('SocialPost');const q=pageDiscoveryQuery(Model.find({isDeleted:false}),readDiscoveryCursor(token,'viewer-a',1001),'posts',99999);
        assert.deepEqual(q.options.sort,{createdAt:-1,_id:-1});assert.equal(q.options.skip,0);assert.ok(q.getFilter().$and[2].$or);
    }finally{if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
});
test('cursor pages retain sentinels and remain disjoint when new rows arrive or scores change',async()=>{
    const previous=process.env.JWT_SECRET;process.env.JWT_SECRET='cursor-feed-regression-key-at-least-32-characters';
    const names=['SocialPost','Reel','Route','User','VibeConfig'];const originals=[];const queries=[];
    const id=n=>new mongoose.Types.ObjectId(n.toString(16).padStart(24,'0'));
    const stamp=new Date(Date.now()-10000);const author=id(9000);
    const datasets={SocialPost:Array.from({length:26},(_,i)=>({_id:id(i+1),createdAt:stamp,user:author,caption:'post',likeCount:i,media:[]})),
        Reel:Array.from({length:22},(_,i)=>({_id:id(i+101),createdAt:stamp,userId:author,videoUrl:'uploads/reel.mp4',isApproved:true,isPublic:true})),Route:[]};
    datasets.SocialPost.push({_id:id(28),createdAt:stamp,user:author,visibility:'PRIVATE',caption:'private',media:[]});
    const matches=(row,filter)=>Object.entries(filter).every(([key,value])=>{
        if(key==='$and')return value.every(f=>matches(row,f));if(key==='$or')return value.some(f=>matches(row,f));
        if(key==='createdAt'){if(value instanceof Date)return +row.createdAt===+value;return Object.entries(value).every(([op,date])=>op==='$lt'?+row.createdAt<+date:op==='$lte'?+row.createdAt<=+date:true);}
        if(key==='visibility')return value.$in.includes(row.visibility ?? null);
        if(key==='_id'){if(value.$exists===false)return false;if(value.$lt)return String(row._id)<String(value.$lt);}
        return true;
    });
    for(const name of names){const Model=mongoose.model(name);for(const method of ['find','findById'])originals.push([Model,method,Model[method]]);
        Model.find=filter=>{
            if(name==='User')return fake([]);
            const q=new mongoose.Query(filter,{},Model);q.exec=async()=>{queries.push({name,skip:q.options.skip||0});
                return (datasets[name]||[]).filter(row=>matches(row,q.getFilter())).sort((a,b)=>+b.createdAt-+a.createdAt || String(b._id).localeCompare(String(a._id))).slice(q.options.skip||0,(q.options.skip||0)+(q.options.limit||100));};return q;
        };
        Model.findById=()=>fake(name==='VibeConfig'?new Model({_id:'default_config'}):null);
    }
    try {
        const seen=new Set();let query={pagination:'cursor'};let pages=0;
        while(true){const result=await buildDiscoveryPage({query});pages++;
            for(const item of result.data.items){const key=item.type+':'+item._id;assert.equal(seen.has(key),false,key);seen.add(key);}
            if(pages===1){datasets.SocialPost.push({_id:id(888),createdAt:new Date(Date.now()+5000),user:author,caption:'new',media:[]});datasets.SocialPost[0].likeCount=999999;}
            if(!result.data.hasMore){assert.equal(result.data.nextCursor,null);break;}
            assert.ok(result.data.nextCursor);query={cursor:result.data.nextCursor};assert.ok(pages<10);
        }
        assert.equal(seen.size,48);assert.ok(pages>=3);assert.ok(queries.every(q=>q.skip===0));
    }finally{for(const [Model,method,original]of originals)Model[method]=original;if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
});
test('unsupported reactions acknowledge failure without mutating or broadcasting a reaction',()=>{
    const handlers={},events=[];const socket={on:(name,handler)=>handlers[name]=handler,emit:(name,value)=>events.push([name,value])};
    registerUnsupportedChatEvents(socket);let ack;
    handlers.message_reaction({messageId:'any',emoji:'test'},value=>ack=value);
    assert.equal(ack.code,'FEATURE_UNSUPPORTED');assert.equal(ack.status,'error');
    assert.deepEqual(events.map(e=>e[0]),['message_reaction_unsupported']);
});
test('lazy module loading coalesces imports and retries after a failed import',async()=>{
    let loads=0,calls=0;const middleware=lazyRouter(async()=>{loads++;if(loads===1)throw Error('import failed');return {default:(req,res,next)=>{calls++;next();}};});
    const invoke=()=>new Promise(resolve=>middleware({}, {},resolve));
    assert.match((await invoke()).message,/import failed/);
    await Promise.all([invoke(),invoke()]);assert.equal(loads,2);assert.equal(calls,2);
});
test('standalone startup and graceful shutdown close the listener, socket loop and cron',async()=>{
    const previous={PORT:process.env.PORT,MONGO_URI:process.env.MONGO_URI,JWT_SECRET:process.env.JWT_SECRET};
    process.env.PORT='0';process.env.MONGO_URI='mongodb://127.0.0.1:27017/unit-only';process.env.JWT_SECRET='bootstrap-regression-key-at-least-32-characters';
    const {startServer}=await import('../server.js');
    const before=process.listenerCount('SIGTERM');
    try{const runtime=await startServer({connect:async()=>{},initialize:()=>{},connectCache:async()=>{}});
        assert.equal((await fetch('http://127.0.0.1:'+runtime.server.address().port+'/api/health')).status,200);
        await Promise.all([runtime.shutdown(),runtime.shutdown()]);assert.equal(runtime.server.listening,false);assert.equal(process.listenerCount('SIGTERM'),before);
    }finally{for(const [name,value]of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
