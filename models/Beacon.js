import mongoose from 'mongoose';

const rideBeaconSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true } // [longitude, latitude]
    },
    meetupTime: { type: Date, required: true },
    pace: {
        type: String,
        enum: ['CHILL', 'TOURING', 'SPORT', 'TRACK_PRACTICE'],
        default: 'CHILL'
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'COMPLETED', 'CANCELED'],
        default: 'ACTIVE'
    },
    message: { type: String, maxlength: 100 }
}, {
    timestamps: true,
    versionKey: false
});

// Create 2dsphere index for GeoSpatial Queries
rideBeaconSchema.index({ location: '2dsphere' });

const RideBeacon = mongoose.models.RideBeacon || mongoose.model('RideBeacon', rideBeaconSchema);
export default RideBeacon;
