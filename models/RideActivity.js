import mongoose from 'mongoose';

const rideActivitySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' }, // Optional link to a known route

    startTime: { type: Date, required: true },
    endTime: Date,
    duration: String, // e.g. "1h 20m"

    distance: { type: Number, required: true }, // in km
    maxSpeed: { type: Number, default: 0 },
    avgSpeed: Number,

    path: [{
        lat: Number,
        lng: Number,
        timestamp: Number
    }],

    weather: {
        temp: Number,
        condition: String
    },

    bikeModel: String,

    isPublic: { type: Boolean, default: true }
}, {
    timestamps: true
});

const RideActivity = mongoose.models.RideActivity || mongoose.model('RideActivity', rideActivitySchema);
export default RideActivity;
