import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import GroupRide from '../modules/rides/GroupRide.model.js';
import { normalizeLegacyGroup } from '../modules/rides/compatibility.service.js';

export const migrateGroupRides=async({legacy,canonical,apply=false})=>{
    const summary={inspected:0,pending:0,promoted:0,existing:0,invalid:0,collisions:0};
    for await(const raw of legacy.find({}).batchSize(100)){
        summary.inspected++;
        const current=await canonical.findOne({_id:raw._id});
        if(current){if(current.kind==='group')summary.existing++;else summary.collisions++;continue;}
        const document=new GroupRide(normalizeLegacyGroup(raw));
        try {await document.validate();}catch{summary.invalid++;continue;}
        summary.pending++;
        if(apply){
            try {const result=await canonical.updateOne({_id:raw._id},{$setOnInsert:document.toObject({virtuals:false})},{upsert:true});if(result.upsertedCount)summary.promoted++;else {const concurrent=await canonical.findOne({_id:raw._id});if(concurrent?.kind!=='group')summary.collisions++;else summary.existing++;}}
            catch(error){if(error.code!==11000)throw error;const concurrent=await canonical.findOne({_id:raw._id});if(concurrent?.kind==='group')summary.existing++;else summary.collisions++;}
        }
    }
    return summary;
};
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
    await import('dotenv/config');
    const { getMongoUri }=await import('../config/env.js');
    const apply=process.argv.includes('--apply');
    await mongoose.connect(getMongoUri(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    try {const summary=await migrateGroupRides({legacy:mongoose.connection.collection('grouprides'),canonical:GroupRide.collection,apply});console.log(JSON.stringify({mode:apply?'apply':'dry-run',...summary}));if(summary.invalid || summary.collisions)process.exitCode=2;}
    finally {await mongoose.disconnect();}
}
