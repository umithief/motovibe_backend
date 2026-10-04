import mongoose from 'mongoose';

const telemetrySchema = new mongoose.Schema({
    timestamp: { type: Date, required: true },
    speed: { type: Number, required: true }, // km/h
    leanAngle: { type: Number, default: 0 }, // degrees
    altitude: { type: Number, default: 0 }, // meters
    gForce: { type: Number, default: 0 }
}, { _id: false });

const rideSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    bikeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UserBike'
    },
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
    route: {
        type: {
            type: String,
            enum: ['LineString'],
            required: true,
            default: 'LineString'
        },
        coordinates: {
            type: [[Number]], // [ [lng, lat], [lng, lat] ]
            required: true
        }
    },
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
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

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

export default mongoose.model('Ride', rideSchema);
