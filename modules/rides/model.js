import groupRideSchema from './group.schema.js';
import mongoose from 'mongoose';

const telemetrySchema = new mongoose.Schema({
    timestamp: { type: Date, required: true },
    speed: { type: Number, required: true }, // km/h
    leanAngle: { type: Number, default: 0 }, // degrees
    altitude: { type: Number, default: 0 }, // meters
    gForce: { type: Number, default: 0 }
}, { _id: false });

const rideGeometrySchema=new mongoose.Schema({
    type:{type:String,enum:['LineString'],required:true,default:'LineString'},
    coordinates:{type:[[Number]],required:true,validate:{
        validator:points=>points.length>=2 && points.every(point=>point.length===2 && point.every(Number.isFinite) && Math.abs(point[0])<=180 && Math.abs(point[1])<=90),
        message:'En az iki geçerli koordinat gereklidir.'
    }}
},{_id:false});
const rideSchema = new mongoose.Schema({
    kind:{type:String,default:'solo'},
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref:'User' },
    activity: { type: mongoose.Schema.Types.Mixed },
    // References User.garage._id on this ride's owner; garage bikes are embedded.
    bikeId: { type: mongoose.Schema.Types.ObjectId },
    title: {
        type: String,
        required: [true, 'Sürüş adı zorunludur'],
        trim: true,
        default: 'İsimsiz Sürüş'
    },
    date: {
        type: Date,
        default: Date.now
    },
    description: {
        type: String,
        trim: true
    },
    // GeoJSON for Map Storage
    route: {type:rideGeometrySchema,default:undefined,required:function(){return !this.activity && this.kind!=='group';}},
    // Raw Data for Playback/Analysis
    telemetry: [telemetrySchema],

    // Aggregated Statistics for Fast Display
    stats: {
        maxSpeed: { type: Number, default: 0 },
        avgSpeed: { type: Number, default: 0 },
        totalDistance: { type: Number, default: 0 }, // km
        duration: { type: Number, default: 0 }, // seconds
        maxLeanAngle: { type: Number, default: 0 },
        maxGForce: { type: Number, default: 0 },
        elevationGain: { type: Number, default: 0 }
    },

    // Social / Privacy
    isPublic: { type: Boolean, default: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: String,
        date: { type: Date, default: Date.now }
    }]
}, {
    discriminatorKey: 'kind',
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

rideSchema.pre('validate', function () {
    if(this.kind==='group')this.user=this.organizer?.userId || this.user || this.userId;
    this.user ||= this.userId;
    this.userId = this.user;
});
rideSchema.pre('init', function (doc) { doc.user ||= doc.userId || doc.organizer?.userId; doc.userId ||= doc.user; });
rideSchema.index({user:1,date:-1,_id:-1});
// Spatial Index for potential future "Rides Near Me" features
rideSchema.index({ route: '2dsphere' });

// Static method for Leaderboards
rideSchema.statics.getTopRides = function (criteria = 'speed', limit = 3) {
    const sort = criteria === 'distance' ? { 'stats.totalDistance': -1 } : { 'stats.maxSpeed': -1 };
    return this.find({ isPublic: true })
        .sort(sort)
        .limit(limit)
        .populate('userId', 'name avatar rank');
};

// Solo/activity queries do not accidentally include scheduled group events.
rideSchema.pre(['find','findOne','countDocuments','findOneAndUpdate','findOneAndDelete','updateOne','updateMany','deleteOne','deleteMany'],function(){
    if(this.model.modelName==='Ride')this.where({kind:{$ne:'group'}});
});
rideSchema.pre('aggregate',function(){
    if(this.model().modelName!=='Ride')return;
    const pipeline=this.pipeline();
    if(pipeline[0]?.$geoNear)pipeline[0].$geoNear.query={$and:[pipeline[0].$geoNear.query || {},{kind:{$ne:'group'}}]};
    else pipeline.unshift({$match:{kind:{$ne:'group'}}});
});
const Ride=mongoose.models.Ride || mongoose.model('Ride',rideSchema);
export const GroupRide=Ride.discriminators?.GroupRide || Ride.discriminator('GroupRide',groupRideSchema,'group');
export default Ride;
