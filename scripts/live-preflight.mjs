import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { Client } from 'ssh2';
import mongoose from 'mongoose';
import { getSshConfig } from '../config/deploy.js';
import { getMongoUri } from '../config/env.js';
import { migrateGroupRides } from './migrate-group-rides.mjs';

// Read configuration locally; never print credentials or copy server environment files.
dotenv.config({quiet:true});
const pinPath=process.env.DEPLOY_PIN_FILE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'Motonom','operations','motonom-host-pin.json');
const pin=JSON.parse(await fs.readFile(pinPath,'utf8'));
const config=getSshConfig();
if(pin.host!==config.host || !/^[a-f0-9]{64}$/.test(pin.sha256))throw Error('Invalid SSH host pin');
if(process.env.DEPLOY_HOST_KEY_SHA256_HEX && process.env.DEPLOY_HOST_KEY_SHA256_HEX.toLowerCase()!==pin.sha256)throw Error('SSH pin mismatch');
process.env.DEPLOY_HOST_KEY_SHA256_HEX ||= pin.sha256;
const targetFingerprint=uri=>{const parsed=new URL(uri);return crypto.createHash('sha256').update(parsed.protocol+'//'+parsed.host+parsed.pathname).digest('hex');};
const remoteProbe=String.raw`
(async()=>{
 const fs=require('node:fs'),crypto=require('node:crypto');
 const req=require('node:module').createRequire('/var/www/motovibe/package.json');
 req('dotenv').config({path:'/var/www/motovibe/.env',quiet:true});
 const mongoose=req('mongoose'),Redis=req('ioredis');
 const summary={node:process.versions.node,mongo:'failed',redis:'failed'};
 const uri=process.env.MONGO_URI || process.env.MONGODB_URI;
 let connection,cache;
 try{
   const parsed=new URL(uri);
   summary.mongoTarget=crypto.createHash('sha256').update(parsed.protocol+'//'+parsed.host+parsed.pathname).digest('hex');
   connection=await mongoose.createConnection(uri,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000}).asPromise();
   summary.mongo=(await connection.db.command({ping:1})).ok===1?'passed':'failed';
 }catch(error){summary.mongoError=String(error.code || error.name);}
 try{
   cache=new Redis(process.env.REDIS_URI || process.env.REDIS_URL || 'redis://127.0.0.1:6379',{lazyConnect:true,retryStrategy:()=>null,maxRetriesPerRequest:0,connectTimeout:3000});
   cache.on('error',()=>{});await cache.connect();summary.redis=await cache.ping()==='PONG'?'passed':'failed';
 }catch(error){summary.redisError=String(error.code || error.name);}
 finally{cache?.disconnect();if(connection)await connection.close();}
 const rideSource=fs.readFileSync('/var/www/motovibe/modules/rides/model.js','utf8');
 summary.groupStorageCompatible=rideSource.includes("discriminatorKey: 'kind'") && rideSource.includes("kind:{$ne:'group'}");
 summary.serverFingerprint=crypto.createHash('sha256').update(fs.readFileSync('/var/www/motovibe/server.js')).digest('hex');
 console.log('MOTONOM_PREFLIGHT '+JSON.stringify(summary));
})().catch(error=>{console.log('MOTONOM_PREFLIGHT '+JSON.stringify({error:String(error.code||error.name)}));process.exitCode=1;});`;
const command="node -e 'eval(Buffer.from(\""+Buffer.from(remoteProbe).toString('base64')+"\",\"base64\").toString())'";
const remote=await new Promise((resolve,reject)=>{
 const client=new Client();let output='';const timer=setTimeout(()=>{client.end();reject(Error('SSH preflight timeout'));},45000);
 client.on('error',error=>{clearTimeout(timer);reject(Error('SSH preflight failed: '+(error.level || error.code || 'connection')));});
 client.on('ready',()=>client.exec(command,(error,stream)=>{if(error){client.end();clearTimeout(timer);reject(Error('SSH command failed'));return;}
  stream.on('data',chunk=>{output+=chunk;if(output.length>65536){client.end();clearTimeout(timer);reject(Error('Unexpected preflight output'));}});
  stream.on('close',()=>{client.end();clearTimeout(timer);const line=output.split('\n').find(line=>line.startsWith('MOTONOM_PREFLIGHT '));if(!line){reject(Error('Remote preflight did not return a summary'));return;}resolve(JSON.parse(line.slice(18)));});
 }));
 client.connect({...config,hostHash:'sha256',hostVerifier:hash=>hash===pin.sha256,algorithms:{serverHostKey:[pin.algorithm]},readyTimeout:10000});
});
const localTarget=targetFingerprint(getMongoUri());
const matches=remote.mongoTarget===localTarget;
const report={checkedAt:new Date().toISOString(),sshHostPinned:true,node:remote.node,node20:remote.node?.startsWith('20.'),mongo:remote.mongo,redis:remote.redis,configuredMongoMatchesLive:matches,
 groupStorageCompatible:remote.groupStorageCompatible, serverEntryMatchesLocal:remote.serverFingerprint===crypto.createHash('sha256').update(await fs.readFile(new URL('../server.js',import.meta.url))).digest('hex')};
if(matches && remote.mongo==='passed'){
 const connection=await mongoose.createConnection(getMongoUri(),{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000}).asPromise();
 try{report.groupMigration={mode:'dry-run',...await migrateGroupRides({legacy:connection.db.collection('grouprides'),canonical:connection.db.collection('rides')})};}
 finally{await connection.close();}
}else report.groupMigration={mode:'blocked',reason:'Live database target could not be verified'};
if(process.argv.includes('--apply'))throw Error('This preflight never applies migrations');
console.log(JSON.stringify(report,null,2));
