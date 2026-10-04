import mongoose from 'mongoose';

const analyticsSchema = new mongoose.Schema({
    type: { type: String, required: true },
    userId: String,
    userName: String,
    productId: Number,
    productName: String,
    postId: String,
    contentType: { type: String, enum: ['post', 'reel', 'route', 'ad'] },
    source: { type: String, maxlength: 32 },
    isSponsored: Boolean,
    durationMs: { type: Number, min: 0, max: 30 * 60 * 1000 },
    duration: Number,
    timestamp: { type: Number, default: Date.now },
    date: {
        type: String,
        default: () => new Date().toLocaleDateString('tr-TR'),
    },
}, { versionKey: false });

const Analytics = mongoose.models.Analytics ||
    mongoose.model('Analytics', analyticsSchema);

export default Analytics;
