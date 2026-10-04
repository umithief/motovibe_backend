import mongoose from 'mongoose';

const roadReportSchema = new mongoose.Schema({
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: {
        type: String,
        required: true,
        enum: ['hazard', 'construction', 'gravel', 'poor_surface', 'accident', 'police_control', 'road_closure', 'flood', 'animal_hazard', 'oil_slippery', 'other']
    },
    description: { type: String, trim: true, maxlength: 600, default: '' },
    location: {
        type: { type: String, enum: ['Point'], required: true, default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    verificationScore: { type: Number, default: 0, min: 0, max: 100 },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
}, { timestamps: true, versionKey: false });

roadReportSchema.index({ location: '2dsphere' });

export default mongoose.models.RoadReport || mongoose.model('RoadReport', roadReportSchema);
