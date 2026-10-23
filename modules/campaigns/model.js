import mongoose from 'mongoose';

const rewardSchema = new mongoose.Schema({
    badgeUrl: { type: String },
    discountCode: { type: String }, // e.g. "VIBE-PIR-15"
    description: { type: String },  // e.g. "%15 İndirim"
}, { _id: false });

const campaignSchema = new mongoose.Schema({
    sponsorName: { type: String, required: true },
    brandLogo: { type: String, required: true }, // transparent PNG URL
    type: {
        type: String,
        enum: ['MAP_PIN', 'CHALLENGE', 'SPONSORED_ROUTE'],
        required: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    reward: { type: rewardSchema, required: true },
    targetMetric: { type: Number, default: 0 }, // km, count, etc.
    // GeoJSON Point – only for MAP_PIN type
    location: {
        type: {
            type: String,
            enum: ['Point'],
        },
        coordinates: { type: [Number] }, // [longitude, latitude]
    },
    brandColor: { type: String, default: '#E2FF3B' }, // HEX for UI accent
    activeUntil: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false });

// 2dsphere index for proximity queries on MAP_PIN campaigns
campaignSchema.index({ location: '2dsphere' });

const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);
export default Campaign;
