import mongoose from 'mongoose';

const vlogSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: String,
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    locationName: String,
    coordinates: { lat: Number, lng: Number },
    videoUrl: { type: String, required: true },
    thumbnail: String,
    views: { type: String, default: '0' },
    productsUsed: [Number]
}, { versionKey: false, timestamps: true });

const MotoVlog = mongoose.models.MotoVlog || mongoose.model('MotoVlog', vlogSchema);

export default MotoVlog;
