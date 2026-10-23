import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import redis from '../config/redis.js';
import { disabledFeaturePrefixes } from '../config/release.js';
import { serializeMediaUrls } from '../utils/serializeMediaUrls.js';

export const fakeQuery = value => {
    const query = { then(resolve,reject) { return Promise.resolve(value).then(resolve,reject); } };
    for (const method of ['sort','select','skip','limit','populate','lean']) query[method] = () => query;
    return query;
};
test('app imports without starting Mongo, Redis, sockets, cron or an HTTP listener', () => {
    assert.equal(mongoose.connection.readyState,0);
    assert.equal(redis.raw.status,'wait');
    const server = fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
    const app = fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
    const index = fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
    assert.doesNotMatch(app,/res\.json\s*=|JSON\.parse\(JSON\.stringify|seedDatabase|\.listen\(/);
    assert.doesNotMatch(server,/seedDatabase|SEED_DEMO_DATA|ensureDefaultAchievements/);
    assert.doesNotMatch(index,/server\.js|listen\(|initSync|Cron/);
});
test('media serialization preserves source data, BSON and dates and normalizes every supported field', () => {
    const req = {protocol:'https',get:()=>'api.example'};
    const date = new Date(); const id = new mongoose.Types.ObjectId();
    const stable = {text:'same',date,id};
    const input = {stable, avatar:'uploads/a.png', coverImage:'/uploads/c.png',image:'uploads/i.png',
        thumbnail:'uploads/t.png',imageUrl:'uploads/x.png',videoUrl:'uploads/v.mp4',emblem:'uploads/e.png',
        media:[{url:'uploads/m.mp4'}], external:{image:'https://cdn.example/image.png'}};
    const output = serializeMediaUrls(input,req);
    assert.equal(output.stable,stable);
    assert.equal(output.stable.date,date); assert.equal(output.stable.id,id);
    assert.equal(output.external,input.external);
    for (const field of ['avatar','coverImage','image','thumbnail','imageUrl','videoUrl','emblem']) assert.match(output[field],/^https:\/\/api\.example\/api\/uploads\//);
    assert.equal(output.media[0].url,'https://api.example/api/uploads/m.mp4');
    assert.equal(input.avatar,'uploads/a.png');
    assert.equal(serializeMediaUrls(stable,req),stable);
    const User = mongoose.model('User');
    const user = new User({name:'Pilot',username:'pilot',email:'pilot@example.test',avatar:'uploads/pilot.png'});
    assert.equal(serializeMediaUrls(user,req).avatar,'https://api.example/api/uploads/pilot.png');
    assert.equal(user.avatar,'uploads/pilot.png');
});
test('release endpoints, core Flutter paths and compatibility redirects work through HTTP', async () => {
    const originals = [];
    for (const model of Object.values(mongoose.models)) {
        for (const [method,value] of Object.entries({find:[],findOne:null,findById:null,countDocuments:0,aggregate:[]})) {
            originals.push([model,method,model[method]]);
            model[method] = () => fakeQuery(value);
        }
    }
    const VibeConfig = mongoose.model('VibeConfig');
    VibeConfig.findById = () => fakeQuery(new VibeConfig({_id:'default_config'}));
    const server = http.createServer(createApp());
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = 'http://127.0.0.1:'+server.address().port;
    try {
        for (const prefix of Object.values(disabledFeaturePrefixes).flat()) {
            for(const [method,path] of [['GET',prefix],['POST',prefix+'/disabled-contract-probe']]) {
            const response = await fetch(base+path,{method}); const body = await response.json();
            assert.equal(response.status,404,path); assert.equal(body.code,'FEATURE_DISABLED',path);
            assert.equal(body.error.code,'FEATURE_DISABLED',path); assert.equal(body.data,null);
            }
        }
        for (const path of ['/api/health','/api/home/summary','/api/posts/discover','/users/login']) {
            const response = await fetch(base+path,path.endsWith('/login') ? {method:'POST',headers:{'content-type':'application/json'},body:'{}'} : {});
            assert.notEqual(response.status,404,path);
            if (!path.endsWith('/login')) assert.equal(response.status,200,path);
        }
        for (const [method,path] of [['GET','/api/reels'],['GET','/api/messages/threads'],['GET','/api/packs'],['GET','/api/rides/group-rides'],['GET','/api/routes'],['GET','/api/notifications'],['GET','/api/stories'],['GET','/api/events'],['POST','/api/upload'],['GET','/api/tags/trending']]) {
            const response = await fetch(base+path,{method}); assert.notEqual(response.status,404,method+' '+path);
        }
        const missingRoute=await fetch(base+'/api/routes/000000000000000000000001');
        assert.equal(missingRoute.status,404);assert.equal((await missingRoute.json()).error.message,'Route not found');
        const social = await fetch(base+'/api/social/discover?category=videos',{redirect:'manual'});
        assert.equal(social.status,308); assert.equal(social.headers.get('location'),'/api/posts/discover?category=videos');
        for (const path of ['/api/campaigns','/api/sponsorship/campaigns','/api/sponsorship/nearby']) {
            const response = await fetch(base+path); assert.notEqual(response.status,404,path);
        }
    } finally {
        server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
        for (const [model,method,original] of originals) model[method] = original;
    }
});
test('demo seed validates its open-domain documents and excludes shop models', async () => {
    const { seedDatabase } = await import('../scripts/seed-demo.mjs');
    const names = ['Route','MeetupEvent','Emoji']; const originals=[]; let validated=0;
    for (const name of names) {
        const Model = mongoose.model(name);
        for (const method of ['countDocuments','insertMany','findOneAndUpdate']) originals.push([Model,method,Model[method]]);
        Model.countDocuments = async()=>0;
        Model.insertMany = async documents => { for (const item of documents) { await new Model(item).validate(); validated++; } };
        Model.findOneAndUpdate = async (filter,update) => { await new Model(update.$set).validate(); validated++; };
    }
    try { await seedDatabase(); assert.equal(validated,10); }
    finally { for (const [Model,method,original] of originals) Model[method]=original; }
    const source = fs.readFileSync(new URL('../scripts/seed-demo.mjs',import.meta.url),'utf8');
    assert.doesNotMatch(source,/Product|ForumTopic|ShowcaseProduct|SEED_ADMIN/);
});

test('user controller retains all original public export names after file separation', async () => {
    const manifest=JSON.parse(fs.readFileSync(new URL('../docs/user-controller-export-manifest.json',import.meta.url),'utf8'));
    const controller=await import("../modules/users/controller.js");
    assert.deepEqual(Object.keys(controller).sort(),Object.entries(manifest).filter(([,entry])=>entry.public).map(([name])=>name).sort());
});
test('legacy activity input cannot spoof its owner and validates as the canonical Ride', async () => {
    const {buildActivityRideInput,rideOwnerFilter}=await import('../modules/rides/service.js');
    const user=new mongoose.Types.ObjectId();const other=new mongoose.Types.ObjectId();
    const input=buildActivityRideInput({user:other,userId:other,startTime:'2026-10-11T10:00:00Z',distance:12,path:[{lat:41,lng:29},{lat:41.1,lng:29.1}]},user);
    const Ride=mongoose.model('Ride');const ride=new Ride(input);await ride.validate();
    assert.equal(String(ride.user),String(user));assert.equal(String(ride.userId),String(user));assert.equal(String(ride.activity.user),String(user));
    assert.deepEqual(rideOwnerFilter(user),{$or:[{user},{user:null,userId:user}]});
    assert.throws(()=>buildActivityRideInput({startTime:'bad',distance:12},user));
});

test('activity without GPS stores no invalid geometry, and solo Ride still requires a valid LineString',async()=>{
    const {buildActivityRideInput}=await import('../modules/rides/service.js');
    const Ride=mongoose.model('Ride');const user=new mongoose.Types.ObjectId();
    const activity=new Ride(buildActivityRideInput({startTime:'2026-10-11T10:00:00Z',distance:2},user));
    await activity.validate();assert.equal(activity.route,undefined);
    await assert.rejects(new Ride({user,title:'ride'}).validate());
    await assert.rejects(new Ride({user,route:{type:'LineString',coordinates:[[29,41]]}}).validate());
});
