import mongoose from 'mongoose';
import AppError from '../../utils/appError.js';

export const normalizeLegacyGroup=raw=>({...raw,kind:'group',user:raw.organizer?.userId || raw.user || raw.userId,userId:raw.organizer?.userId || raw.user || raw.userId});
export const groupReadPipeline=(filter={},options={},projection)=>{
    const pipeline=[{$match:{$and:[{kind:'group'},filter]}},{$unionWith:{coll:'grouprides',pipeline:[
        {$set:{kind:'group',user:{$ifNull:['$organizer.userId',{$ifNull:['$user','$userId']}]},userId:{$ifNull:['$organizer.userId',{$ifNull:['$user','$userId']}]},__legacy:true}},
        {$match:filter},{$lookup:{from:'rides',localField:'_id',foreignField:'_id',as:'__canonical'}},
        {$match:{'__canonical.0':{$exists:false}}},{$unset:'__canonical'},
    ]}}];
    if(options.sort && Object.keys(options.sort).length)pipeline.push({$sort:options.sort});
    if(options.skip)pipeline.push({$skip:options.skip});
    if(options.limit)pipeline.push({$limit:Math.abs(options.limit)});
    if(projection && Object.keys(projection).length){
        const inclusion=Object.entries(projection).some(([key,value])=>key!=='_id' && value===1);
        pipeline.push({$project:inclusion?{...projection,__legacy:1}:projection});
    }
    return pipeline;
};

// Idempotent promotion copies the original snapshot before Mongoose applies dirty paths.
// Legacy storage is never modified. An existing canonical row always wins.
export const promoteLegacyGroup=async({legacy,canonical,filter})=>{
    const {kind:ignoredKind,...legacyFilter}=filter;
    const raw=await legacy.findOne(legacyFilter);
    if(!raw)return null;
    const current=await canonical.findOne({_id:raw._id});
    if(current){if(current.kind!=='group')throw new AppError('Sürüş kimliği başka bir kayıtla çakışıyor.',409);return current;}
    const normalized=normalizeLegacyGroup(raw);
    if(!normalized.user)throw new AppError('Eski sürüşün organizatörü bulunamadı.',409);
    try {await canonical.updateOne({_id:raw._id},{$setOnInsert:normalized},{upsert:true});}
    catch(error){if(error.code!==11000)throw error;}
    const promoted=await canonical.findOne({_id:raw._id});
    if(!promoted || promoted.kind!=='group')throw new AppError('Sürüş kimliği başka bir kayıtla çakışıyor.',409);
    return promoted;
};

export const installGroupCompatibility=schema=>{
    schema.pre(['find','findOne','countDocuments'],async function(){
        if(this.model.modelName!=='GroupRide')return;
        this.cast(this.model);
        const options=this.getOptions();
        const pipeline=groupReadPipeline(this.getFilter(),this.op==='countDocuments'?{}:{...options,limit:this.op==='findOne'?1:options.limit},this.op==='countDocuments'?undefined:this.projection());
        if(this.op==='countDocuments')pipeline.push({$count:'total'});
        const rows=await this.model.collection.aggregate(pipeline,{session:options.session,maxTimeMS:options.maxTimeMS}).toArray();
        if(this.op==='countDocuments')throw mongoose.skipMiddlewareFunction(rows[0]?.total || 0);
        const lean=this.mongooseOptions().lean;
        let results=rows.map(row=>{
            const {__legacy,...data}=row;
            const result=lean?data:this.model.hydrate(data,this.projection());
            if(!lean && __legacy)result.$locals.legacyGroup=true;
            return result;
        });
        const populate=Object.values(this.mongooseOptions().populate || {});
        if(populate.length)results=await this.model.populate(results,populate);
        throw mongoose.skipMiddlewareFunction(this.op==='findOne'?results[0] || null:results);
    });
    schema.pre('save',async function(){
        if(!this.$locals.legacyGroup)return;
        await promoteLegacyGroup({legacy:this.constructor.db.collection('grouprides'),canonical:this.constructor.collection,filter:{_id:this._id}});
        delete this.$locals.legacyGroup;
    });
    schema.pre(['findOneAndUpdate','updateOne'],async function(){
        if(this.model.modelName!=='GroupRide')return;
        this.cast(this.model);
        await promoteLegacyGroup({legacy:this.model.db.collection('grouprides'),canonical:this.model.collection,filter:this.getFilter()});
    });
};
