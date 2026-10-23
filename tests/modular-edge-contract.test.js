import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { rateLimitError } from '../middleware/rateLimitError.js';
import { globalErrorHandler } from '../middleware/errorMiddleware.js';
import { seedDatabase } from '../scripts/seed-demo.mjs';
import { findLatestActivity,rideOwnerFilter } from '../modules/rides/service.js';
const fake=value=>{const q={then:(r,j)=>Promise.resolve(value).then(r,j)};for(const method of ['sort','lean','select','limit','populate'])q[method]=()=>q;return q;};

test('real rate limit failures keep legacy JSON/text, Retry-After and 429 while v2 uses the canonical error channel',async()=>{
    const app=express();app.use((req,res,next)=>{req.apiVersion=req.path.startsWith('/v2')?2:1;next();});
    const limiter=message=>rateLimit({windowMs:60000,max:1,handler:rateLimitError,standardHeaders:'draft-8',legacyHeaders:false,...(message?{message}:{})});
    const payload={status:'error',message:'Limit doldu.'};
    for(const prefix of ['/v1','/v2']){app.get(prefix+'/json',limiter(payload),(req,res)=>res.send('ok'));app.get(prefix+'/text',limiter(),(req,res)=>res.send('ok'));}
    app.use(globalErrorHandler);const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
    try {for(const prefix of ['/v1','/v2'])for(const kind of ['json','text']){
        assert.equal((await fetch(base+prefix+'/'+kind)).status,200);const response=await fetch(base+prefix+'/'+kind);assert.equal(response.status,429);assert.ok(response.headers.get('retry-after'));
        if(prefix==='/v1' && kind==='json')assert.deepEqual(await response.json(),payload);
        else if(prefix==='/v1')assert.equal(await response.text(),'Too many requests, please try again later.');
        else {const body=await response.json();assert.equal(body.status,'error');assert.equal(body.data,null);assert.equal(body.error.message,kind==='json'?payload.message:'Too many requests, please try again later.');}
    }}finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('all route rate limiters declare the shared error adapter, and open group GET does not seed data',()=>{
    const files=['auth/routes','users/routes','appointments/routes','business/businessAnalytics.routes','business/businessReview.routes','geo/routes','messages/routes','reports/routes','routes/routes'];
    for(const file of files){const source=fs.readFileSync(new URL('../modules/'+file+'.js',import.meta.url),'utf8');assert.equal((source.match(/rateLimit\(\{/g)||[]).length,(source.match(/handler:rateLimitError/g)||[]).length,file);}
    assert.doesNotMatch(fs.readFileSync(new URL('../modules/rides/groupRide.service.js',import.meta.url),'utf8'),/SEED_DEMO_DATA|SEED_GROUP_RIDES|insertMany/);
});

test('explicit development group seed validates shared Ride documents and never invents an organizer',async()=>{
    const owner={_id:new mongoose.Types.ObjectId(),name:'Development rider',avatar:''};const names=['User','GroupRide','Route','MeetupEvent','Emoji'];const restored=[];let groups=0;
    for(const name of names){const Model=mongoose.model(name);for(const method of ['findById','countDocuments','insertMany']){restored.push([Model,method,Model[method]]);Model.countDocuments=async()=>10;Model.findById=()=>fake(owner);Model.insertMany=async rows=>{for(const row of rows){const doc=new Model(row);await doc.validate();if(name==='GroupRide'){groups++;assert.equal(String(doc.user),String(owner._id));assert.equal(doc.kind,'group');}}};}}
    mongoose.model('GroupRide').countDocuments=async()=>0;
    try {await seedDatabase({organizerId:String(owner._id)});assert.equal(groups,3);mongoose.model('User').findById=()=>fake(null);await assert.rejects(seedDatabase({organizerId:String(owner._id)}),/existing development user/);assert.equal(groups,3);}
    finally {for(const [Model,method,value]of restored)Model[method]=value;}
});

test('read-only legacy activities accept userId only when canonical user is absent and return canonical user',async()=>{
    const Ride=mongoose.model('Ride'),owner=new mongoose.Types.ObjectId();const original=[Ride.findOne,mongoose.connection.collection];let captured;
    const legacy={_id:new mongoose.Types.ObjectId(),userId:owner,startTime:new Date(),distance:2};
    Ride.findOne=()=>fake(null);mongoose.connection.collection=()=>({findOne:async filter=>{captured=filter;return legacy;}});
    try {const response=await findLatestActivity(String(owner));assert.deepEqual(captured,rideOwnerFilter(owner));assert.equal(String(response.user),String(owner));assert.equal(legacy.user,undefined);}
    finally {[Ride.findOne,mongoose.connection.collection]=original;}
});
