import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { responseEnvelope } from '../utils/respond.js';
import { signAccessToken } from '../modules/auth/service.js';
import express from 'express';
import { sendResponse } from '../utils/respond.js';
const fake=value=>{const query={then:(resolve,reject)=>Promise.resolve(value).then(resolve,reject)};for(const method of ['select','sort','lean','populate','limit','skip'])query[method]=()=>query;return query;};
const listener=async()=>{const server=http.createServer(createApp());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,base:'http://127.0.0.1:'+server.address().port};};
const close=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};

test('canonical response envelopes retain data and metadata without mutating legacy payloads',()=>{
    const list=[{_id:'a'}];assert.deepEqual(responseEnvelope(list),{status:'success',data:list});
    const flat={rides:list,hasMore:false};assert.deepEqual(responseEnvelope(flat),{status:'success',data:flat});
    const existing={status:'success',data:list,count:1};assert.deepEqual(responseEnvelope(existing),{status:'success',data:list,meta:{count:1}});
    const gate={status:'fail',message:'PRO gerekli',requiresPro:true};assert.deepEqual(responseEnvelope(gate,403),{status:'error',data:null,error:{message:'PRO gerekli'},meta:{requiresPro:true}});
    assert.deepEqual(gate,{status:'fail',message:'PRO gerekli',requiresPro:true});assert.equal(existing.data,list);
    assert.deepEqual(responseEnvelope(undefined,204),{status:'success',data:null});
});

test('flat legacy JSON remains compatible while canonical aliases and closed prefixes use one envelope',async()=>{
    const cached=[{_id:'item-1',name:'Rotalar'}];
    const fixture=express();fixture.get('/legacy',(req,res)=>sendResponse(req,res,cached));fixture.get('/canonical',(req,res)=>{req.apiVersion=2;sendResponse(req,res,cached);});
    const fixtureServer=http.createServer(fixture);await new Promise(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve));let runtime;
    try {
        const base='http://127.0.0.1:'+fixtureServer.address().port;
        const old=await fetch(base+'/legacy');assert.equal(old.status,200);assert.deepEqual(await old.json(),cached);assert.equal(old.headers.get('x-api-version'),'1');
        const canonical=await fetch(base+'/canonical');assert.equal(canonical.status,200);assert.deepEqual(await canonical.json(),{status:'success',data:cached});assert.equal(canonical.headers.get('x-api-version'),'2');
        runtime=await listener();
        const root=await fetch(runtime.base+'/');assert.equal(root.status,200);assert.equal(await root.text(),'Motonom Backend API Çalışıyor!');
        const health=await fetch(runtime.base+'/api/v2/health');assert.equal(health.status,200);assert.equal((await health.json()).data.service,'motovibe-api');
        for(const path of ['/api/v2/forum','/api/categories','/api/models','/api/v2/categories','/api/v2/models']) {
            const disabled=await fetch(runtime.base+path);assert.equal(disabled.status,404);const error=await disabled.json();assert.equal(error.error.code,'FEATURE_DISABLED');assert.equal(error.data,null);
        }
        const bad=await fetch(runtime.base+'/api/v2/users/login',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'});assert.equal(bad.status,400);assert.equal((await bad.json()).status,'error');
    } finally {if(runtime)await close(runtime.server);await close(fixtureServer);}
});

test('centralized fuel and theme errors preserve exact legacy statuses/bodies and expose canonical errors',async()=>{
    const prior=process.env.JWT_SECRET;process.env.JWT_SECRET='response-compat-contract-key-at-least-32-characters';
    const User=mongoose.model('User'),original=User.findById;const viewer={_id:new mongoose.Types.ObjectId(),tokenVersion:0,isPro:false,preferences:{}};User.findById=()=>fake({...viewer});let runtime;
    try {
        runtime=await listener();const headers={'content-type':'application/json',authorization:'Bearer '+signAccessToken(viewer)};
        const cases=[['POST','/users/fuel-efficiency',{expenses:[]},400,{message:'Hesaplama için en az iki yakıt alımı gereklidir.'}],
            ['POST','/users/fuel-efficiency',{expenses:[{type:'FUEL',date:'2026-10-01',odometer:100,liters:4},{type:'FUEL',date:'2026-10-02',odometer:100,liters:4}]},400,{message:'Geçersiz kilometre verisi algılandı.'}],
            ['PUT','/users/preferences/theme',{accentColor:'#0033CC'},403,{status:'fail',message:'Kokpit Aydinlatmasi ozelligi sadece APEX Suruculeri icin gecerlidir.',requiresApex:true}]];
        for(const [method,path,body,status,expected]of cases){
            const old=await fetch(runtime.base+'/api'+path,{method,headers,body:JSON.stringify(body)});assert.equal(old.status,status);assert.deepEqual(await old.json(),expected);
            const canonical=await fetch(runtime.base+'/api/v2'+path,{method,headers,body:JSON.stringify(body)});assert.equal(canonical.status,status);const payload=await canonical.json();assert.equal(payload.status,'error');assert.equal(payload.data,null);assert.equal(payload.error.message,expected.message);if(expected.requiresApex)assert.equal(payload.meta.requiresApex,true);
        }
    } finally {if(runtime)await close(runtime.server);User.findById=original;if(prior===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=prior;}
});

test('profile update missing-user error keeps its legacy fail status through the central error handler',async()=>{
    const prior=process.env.JWT_SECRET;process.env.JWT_SECRET='profile-compat-contract-key-at-least-32-characters';
    const User=mongoose.model('User'),original=User.findById;const viewer={_id:new mongoose.Types.ObjectId(),tokenVersion:0};let calls=0;User.findById=()=>fake(++calls%2 ? {...viewer}:null);let runtime;
    try {
        runtime=await listener();const headers={'content-type':'application/json',authorization:'Bearer '+signAccessToken(viewer)};
        const response=await fetch(runtime.base+'/api/users/profile',{method:'PATCH',headers,body:JSON.stringify({bioBlocks:[]})});assert.equal(response.status,404);assert.deepEqual(await response.json(),{status:'fail',message:'Kullanıcı bulunamadı.'});
        const canonical=await fetch(runtime.base+'/api/v2/users/profile',{method:'PATCH',headers,body:JSON.stringify({bioBlocks:[]})});assert.equal(canonical.status,404);assert.equal((await canonical.json()).error.message,'Kullanıcı bulunamadı.');
    } finally {if(runtime)await close(runtime.server);User.findById=original;if(prior===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=prior;}
});
