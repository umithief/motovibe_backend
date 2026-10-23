import mongoose from 'mongoose';

const reelSchema = new mongoose.Schema({
    userId: { type: String, required: true, ref: 'User' },
    userName: { type: String, trim: true, maxlength: 120 },
    userAvatar: { type: String, trim: true },
    videoUrl: { type: String, required: true },
    thumbnailUrl: { type: String, trim: true },
    thumbnailWidth: { type: Number, min: 1 },
    thumbnailHeight: { type: Number, min: 1 },
    thumbnailAspectRatio: { type: Number, min: 0.05, max: 20 },
    caption: { type: String, trim: true, maxlength: 2200 },
    audioTrack: { type: String, default: 'Orijinal Ses' },
    bikeModel: { type: String, trim: true, maxlength: 120 },
    linkedBikeId: String,
    linkedRouteId: String,
    isApproved: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    allowComments: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true },
    likes: { type: Number, default: 0, min: 0 },
    views: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    shareCount: { type: Number, default: 0, min: 0 },
    telemetry: {
        maxSpeed: Number,
        leanAngle: Number,
        avgSpeed: Number
    },
    tags: {
        type: [String],
        default: []
    },
    location: { type: String, trim: true, maxlength: 120 },
    likedBy: [String], // Array of user IDs
    isDeleted: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

reelSchema.index({ isDeleted: 1, isApproved: 1, createdAt: -1, _id: -1 });
reelSchema.index({ isApproved: 1, createdAt: -1, _id: -1 });
reelSchema.index({ userId: 1, isDeleted: 1, createdAt: -1, _id: -1 });
reelSchema.index({ likedBy: 1 });
reelSchema.index({ tags: 1, createdAt: -1 });

reelSchema.index({"isApproved":1,"isPublic":1,"isDeleted":1,"createdAt":-1,"_id":-1});
const Reel = mongoose.models.Reel || mongoose.model('Reel', reelSchema);

export default Reel;
