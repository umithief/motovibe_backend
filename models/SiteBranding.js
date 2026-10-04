
import mongoose from 'mongoose';

const siteBrandingSchema = new mongoose.Schema({
    iconType: {
        type: String,
        enum: ['VELOCITY', 'HELMET', 'PISTON', 'TEXT_ONLY'],
        default: 'VELOCITY'
    },
    primaryColor: {
        type: String,
        default: '#E2FF3B'
    },
    accentColor: {
        type: String,
        default: '#FFFFFF'
    },
    fontStyle: {
        type: String,
        enum: ['TECH', 'RACING', 'MINIMAL'],
        default: 'TECH'
    },
    letterSpacing: {
        type: Number,
        default: 0
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const SiteBranding = mongoose.model('SiteBranding', siteBrandingSchema);

export default SiteBranding;
