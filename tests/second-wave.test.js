import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import Ride from '../modules/rides/model.js';
import User from '../modules/users/model.js';
import Tag from '../modules/tags/model.js';
import { getRide, resolveOwnedBikeId } from '../modules/rides/application.service.js';
import { mergeNormalizedTags, syncTagUsage } from '../utils/tagUtils.js';
import { buildRelease, collectReleasePlan, validateReleaseDestination, validateReleaseAcceptance, sourceRoot } from '../scripts/build-release.mjs';
const id=()=>new mongoose.Types.ObjectId();
const fake=value=>{const q={then:(resolve,reject)=>Promise.resolve(value).then(resolve,reject)};for(const method of ['select','lean','populate'])q[method]=()=>q;return q;};

test('ride bike links accept only the authenticated owner garage id without rejecting legacy optional inputs',async()=>{
    const owner=id(),owned=id(),foreign=id();const original=User.exists;const calls=[];
    User.exists=async filter=>{calls.push(filter);return String(filter._id)===String(owner)&&String(filter['garage._id'])===String(owned)?{_id:owner}:null;};
    try{
        assert.equal(await resolveOwnedBikeId(owned,owner),owned);
        assert.equal(await resolveOwnedBikeId(foreign,owner),undefined);
        assert.equal(await resolveOwnedBikeId('invalid',owner),undefined);
        assert.equal(await resolveOwnedBikeId(undefined,owner),undefined);
        assert.equal(calls.length,2);assert.equal(Ride.schema.path('bikeId').options.ref,undefined);
    }finally{User.exists=original;}
});

test('ride detail resolves a real embedded garage bike, excludes private fields and tolerates removed bikes',async()=>{
    const owner=id(),bikeId=id();const ride=new Ride({user:owner,bikeId,isPublic:true,route:{type:'LineString',coordinates:[[29,41],[29.1,41.1]]}});
    const originalRide=Ride.findById,originalUser=User.findOne;let calls=0;
    Ride.findById=()=>fake(ride);
    User.findOne=filter=>{assert.equal(String(filter._id),String(owner));assert.equal(String(filter['garage._id']),String(bikeId));calls++;return fake({garage:[{_id:bikeId,brand:'Yamaha',model:'MT-07',image:'uploads/bike.png',verificationImage:'private.png',maintenanceRecords:[{cost:500}],verificationStatus:'pending'}]});};
    try{
        const result=await getRide({params:{id:ride._id},user:null});assert.equal(result.statusCode,200);assert.equal(result.body.data.bikeId.model,'MT-07');
        assert.equal(result.body.data.bikeId.verificationImage,undefined);assert.equal(result.body.data.bikeId.maintenanceRecords,undefined);assert.equal(result.body.data.bikeId.verificationStatus,undefined);
        assert.equal(String(ride.bikeId),String(bikeId));
        User.findOne=()=>fake(null);assert.equal((await getRide({params:{id:ride._id},user:null})).body.data.bikeId,null);
        ride.isPublic=false;await assert.rejects(getRide({params:{id:ride._id},user:null}),error=>error.statusCode===403);assert.equal(calls,1);
    }finally{Ride.findById=originalRide;User.findOne=originalUser;}
});

test('merged tag helpers keep normalization and increment only added and removed tags',async()=>{
    const originalBulk=Tag.bulkWrite,originalUpdate=Tag.updateMany;let operations,repair;
    Tag.bulkWrite=async value=>{operations=value;};Tag.updateMany=async(filter,update)=>{repair={filter,update};};
    try{
        const next=mergeNormalizedTags({text:'#Viraj #Yol #YOL',tags:['viraj']});assert.deepEqual(next,['viraj','yol']);
        const result=await syncTagUsage({previousTags:['viraj','gece'],nextTags:next});assert.deepEqual(result,{addedTags:['yol'],removedTags:['gece'],finalTags:next});
        assert.deepEqual(operations.map(op=>[op.updateOne.filter.name,op.updateOne.update.$inc.postCount,op.updateOne.upsert]),[['yol',1,true],['gece',-1,false]]);
        assert.deepEqual(repair.filter,{name:{$in:['gece']},postCount:{$lt:0}});
    }finally{Tag.bulkWrite=originalBulk;Tag.updateMany=originalUpdate;}
});

test('release plans exclude legacy barrels and blocked live acceptance cannot create a package',async()=>{
    const plan=await collectReleasePlan();assert.ok(plan.files.includes('modules/geo/providers/routingProvider.js'));assert.ok(plan.files.includes('Dockerfile'));
    assert.ok(plan.files.every(file=>!/^(attic|controllers|routes|services|uploads)[\\/]|\.tar\.gz$/.test(file)));
    assert.throws(()=>validateReleaseDestination(path.join(sourceRoot,'dist-release')),/outside/);
    if(process.platform==='win32')assert.throws(()=>validateReleaseDestination(path.join(sourceRoot.toLowerCase(),'dist-release')),/outside/);
    const destination=path.join(os.tmpdir(),'motonom-acceptance-block-'+Date.now());await assert.rejects(buildRelease(destination),/acceptance/);assert.equal(fs.existsSync(destination),false);
});

test('HTTP package approval is bounded, single use and leaves the default HTTPS gate intact',async()=>{
    const plan=await collectReleasePlan(),now=Date.now();
    const destination=path.join(os.tmpdir(),'motonom-http-approval-package-'+now);
    const checks={health:true,capabilities:true,login:true,discover:true,reels:true,messages:true,https:false,node20:true,mongo:true,redis:true,flutter:true};
    const acceptance={sourceFingerprint:plan.sourceFingerprint,checkedAt:new Date(now).toISOString(),checks,live:{api:'http://31.210.36.57'}};
    const approval={scope:'package-only',once:true,api:acceptance.live.api,sourceFingerprint:plan.sourceFingerprint,output:destination,approvedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString()};
    assert.throws(()=>validateReleaseAcceptance(plan,acceptance,{output:destination,now}),/incomplete/);
    assert.equal(validateReleaseAcceptance(plan,acceptance,{output:destination,httpApproval:approval,now}).httpExceptionUsed,true);
    for(const changes of [{sourceFingerprint:'other'},{api:'http://example.invalid'},{output:destination+'-other'},{expiresAt:new Date(now-1).toISOString()},{scope:'deploy'},{once:false}])assert.throws(()=>validateReleaseAcceptance(plan,acceptance,{output:destination,httpApproval:{...approval,...changes},now}),/HTTP package approval/);
    assert.throws(()=>validateReleaseAcceptance(plan,{...acceptance,checks:{...checks,messages:false}},{output:destination,httpApproval:approval,now}),/incomplete/);
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'motonom-approval-test-'));const approvalFile=path.join(directory,'approval.json');
    try{
        fs.writeFileSync(approvalFile,JSON.stringify(approval));fs.writeFileSync(approvalFile+'.used','{}');
        await assert.rejects(buildRelease(destination,acceptance,approvalFile),error=>error.code==='EEXIST');
        assert.equal(fs.existsSync(destination),false);assert.equal(fs.existsSync(destination+'.tar.gz'),false);
    }finally{fs.unlinkSync(approvalFile);fs.unlinkSync(approvalFile+'.used');fs.rmdirSync(directory);}
});
