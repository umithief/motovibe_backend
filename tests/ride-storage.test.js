import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Ride,{GroupRide} from '../modules/rides/model.js';
import { groupReadPipeline,normalizeLegacyGroup,promoteLegacyGroup } from '../modules/rides/compatibility.service.js';
const id=n=>new mongoose.Types.ObjectId(n.toString(16).padStart(24,'0'));
const event=(n=1)=>({_id:id(n),title:'Grup sürüşü',date:'2026-10-12',time:'08:30',meetingPoint:'Buluşma',organizer:{userId:id(99)},participants:[],status:'scheduled'});

test('solo telemetry, activities and group events share rides while keeping their date and geometry contracts',async()=>{
    assert.equal(GroupRide.collection,Ride.collection);
    assert.equal(GroupRide.collection.name,'rides');
    assert.equal(GroupRide.baseModelName,'Ride');
    const group=new GroupRide(event());await group.validate();
    assert.equal(group.date,'2026-10-12');assert.equal(group.kind,'group');assert.equal(String(group.user),String(id(99)));
    group.organizer.userId=id(100);await group.validate();assert.equal(String(group.userId),String(id(100)));
    const activity=new Ride({user:id(99),activity:{distance:4}});await activity.validate();assert.equal(activity.kind,'solo');assert.ok(activity.date instanceof Date);
    await assert.rejects(new Ride({user:id(99)}).validate(),/route/);
    await assert.rejects(new GroupRide({...event(),date:'2026-02-30'}).validate(),/Tarih/);
});

test('group compatibility pipelines deduplicate before pagination and keep canonical precedence for every filter',()=>{
    const pipeline=groupReadPipeline({status:'scheduled'},{sort:{date:1,_id:1},skip:10,limit:5},{title:1});
    const union=pipeline.find(stage=>stage.$unionWith).$unionWith;
    assert.equal(union.coll,'grouprides');assert.equal(union.pipeline.find(stage=>stage.$lookup).$lookup.from,'rides');
    assert.deepEqual(union.pipeline.find(stage=>stage.$match?.['__canonical.0']).$match,{'__canonical.0':{$exists:false}});
    assert.ok(pipeline.findIndex(stage=>stage.$unionWith)<pipeline.findIndex(stage=>stage.$skip));
    assert.deepEqual(pipeline.at(-1),{$project:{title:1,__legacy:1}});
});

test('real GroupRide query middleware handles find/findById/count, lean, projection and populate without executing legacy model queries',async()=>{
    const originals=[GroupRide.collection.aggregate,GroupRide.collection.find,GroupRide.collection.findOne,GroupRide.populate];const calls=[];
    GroupRide.collection.find=GroupRide.collection.findOne=()=>{throw Error('Native find must be skipped');};
    GroupRide.collection.aggregate=(pipeline)=>{calls.push(pipeline);return {toArray:async()=>pipeline.at(-1).$count?[{total:7}]:[{...normalizeLegacyGroup(event()),__legacy:true}]};};
    GroupRide.populate=async(results,options)=>{assert.equal(options[0].path,'routeId');return results;};
    try {
        const list=await GroupRide.find({status:'scheduled'}).sort({date:1}).skip(2).limit(3);assert.equal(list.length,1);assert.equal(list[0].$locals.legacyGroup,true);
        const one=await GroupRide.findById(id(1)).populate('routeId');assert.equal(String(one._id),String(id(1)));
        const lean=await GroupRide.findById(id(1)).select('title').lean();assert.equal(lean.__legacy,undefined);assert.equal(lean.$locals,undefined);
        assert.equal(await GroupRide.countDocuments(),7);
        assert.deepEqual(calls[0].find(stage=>stage.$skip),{$skip:2});assert.deepEqual(calls[0].find(stage=>stage.$limit),{$limit:3});
    } finally {[GroupRide.collection.aggregate,GroupRide.collection.find,GroupRide.collection.findOne,GroupRide.populate]=originals;}
});

test('legacy promotion is idempotent, preserves the original snapshot and never overwrites a canonical or unrelated ride',async()=>{
    let canonicalRow;let writes=0;const raw=event();
    const legacy={findOne:async filter=>{assert.equal(filter.kind,undefined);return raw;}};
    const canonical={findOne:async()=>canonicalRow,updateOne:async(filter,update)=>{writes++;canonicalRow={...update.$setOnInsert};}};
    const first=await promoteLegacyGroup({legacy,canonical,filter:{_id:raw._id,kind:'group'}});
    assert.equal(first.kind,'group');assert.deepEqual(first.participants,[]);assert.equal(raw.kind,undefined);assert.equal(writes,1);
    first.status='completed';await promoteLegacyGroup({legacy,canonical,filter:{_id:raw._id}});assert.equal(writes,1);assert.equal(canonicalRow.status,'completed');
    canonicalRow={_id:raw._id,kind:'solo'};await assert.rejects(promoteLegacyGroup({legacy,canonical,filter:{_id:raw._id}}),error=>error.statusCode===409);assert.equal(writes,1);
});

test('real legacy document save promotes before participant delta and writes only to rides',async()=>{
    const raw=event();let current;const updates=[];let legacyWrites=0;
    const originalAggregate=GroupRide.collection.aggregate,originalUpdate=GroupRide.collection.updateOne,originalFind=GroupRide.collection.findOne,originalDb=GroupRide.db.collection;
    GroupRide.collection.aggregate=()=>({toArray:async()=>[{...normalizeLegacyGroup(raw),__legacy:true}]});
    GroupRide.collection.findOne=async()=>current;
    GroupRide.collection.updateOne=async(filter,update)=>{updates.push(update);if(update.$setOnInsert)current={...update.$setOnInsert,participants:[]};if(update.$push?.participants)current.participants.push(...update.$push.participants.$each);return {matchedCount:1,modifiedCount:1};};
    GroupRide.db.collection=function(name){if(name==='grouprides')return {findOne:async()=>raw,updateOne:()=>{legacyWrites++;throw Error('No legacy writes');}};return originalDb.call(this,name);};
    try {
        const doc=await GroupRide.findById(raw._id);doc.participants.push({userId:id(101),name:'Pilot'});await doc.save();
        assert.equal(updates.length,2);assert.equal(updates[0].$setOnInsert.participants.length,0);assert.equal(current.participants.length,1);assert.equal(legacyWrites,0);
    } finally {GroupRide.collection.aggregate=originalAggregate;GroupRide.collection.updateOne=originalUpdate;GroupRide.collection.findOne=originalFind;GroupRide.db.collection=originalDb;}
});

test('solo query and aggregate middleware exclude groups but retain records without the new kind field',async()=>{
    const originals=[Ride.collection.find,Ride.collection.aggregate];const queries=[];
    Ride.collection.find=filter=>{queries.push(filter);return {toArray:async()=>[]};};
    Ride.collection.aggregate=pipeline=>{queries.push(pipeline[0].$match);return {toArray:async()=>[]};};
    try {await Ride.find({user:id(99)}).lean();await Ride.aggregate([{$group:{_id:'$user'}}]);for(const query of queries)assert.deepEqual(query.kind,{$ne:'group'});}
    finally {[Ride.collection.find,Ride.collection.aggregate]=originals;}
});
