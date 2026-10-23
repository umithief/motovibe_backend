import { installGroupCompatibility } from './compatibility.service.js';
import mongoose from 'mongoose';

const waypointSchema = new mongoose.Schema({
    name: { type: String, required: true },
    lat: { type: Number },
    lng: { type: Number },
    type: {
        type: String,
        enum: ['start', 'fuel', 'cafe', 'scenic', 'summit', 'end'],
        default: 'scenic'
    },
    order: { type: Number, default: 0 }
}, { _id: false });

const participantSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: 'Pilot' },
    avatar: { type: String, default: '' },
    bike: { type: String, default: '' },
    role: {
        type: String,
        enum: ['leader', 'sweeper', 'rider'],
        default: 'rider'
    },
    joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const groupRideSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Sürüş başlığı zorunludur'],
        trim: true
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    coverImage: {
        type: String,
        default: ''
    },
    routeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Route',
        required: false
    },
    // GeoJSON veya koordinat dizisi
    routeCoordinates: [{
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    }],
    waypoints: [waypointSchema],
    date: {
        type: String, required: true,
        validate: { validator: value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
            message: 'Tarih YYYY-MM-DD biçiminde olmalıdır.' }
    },
    time: {
        type: String, required: true,
        match: [/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Saat HH:mm biçiminde olmalıdır.']
    },
    meetingPoint: {
        type: String,
        required: [true, 'Buluşma noktası zorunludur']
    },
    coordinates: {
        lat: { type: Number, default: 41.0082 },
        lng: { type: Number, default: 28.9784 }
    },
    organizer: {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, default: 'Lider Pilot' },
        avatar: { type: String, default: '' },
        bike: { type: String, default: '' }
    },
    pace: {
        type: String,
        enum: ['chill', 'moderate', 'spirited', 'track'],
        default: 'moderate'
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard', 'expert'],
        default: 'medium'
    },
    minCcRequirement: {
        type: Number,
        default: 0
    },
    distance: {
        type: String,
        default: '45 km'
    },
    estimatedDuration: {
        type: String,
        default: '1 saat 30 dk'
    },
    maxParticipants: {
        type: Number,
        default: 0 // 0 = limitsiz
    },
    status: {
        type: String,
        enum: ['scheduled', 'active', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    participants: [participantSchema],
    liveRadar: {
        isActive: { type: Boolean, default: false },
        startedAt: { type: Date },
        channelId: { type: String, default: '' }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

installGroupCompatibility(groupRideSchema);
groupRideSchema.index({ status: 1, date: 1, time: 1 });
groupRideSchema.index({ 'participants.userId': 1, status: 1, date: 1 });
groupRideSchema.index({ 'organizer.userId': 1, status: 1, date: 1 });

groupRideSchema.virtual('participantCount').get(function () {
    return (this.participants?.length || 0) + 1; // +1 organizer
});


export default groupRideSchema;
