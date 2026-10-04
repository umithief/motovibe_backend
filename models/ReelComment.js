import mongoose from 'mongoose';

const reelCommentSchema = new mongoose.Schema({
    content: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reel: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true },
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    versionKey: false
});

reelCommentSchema.index({ reel: 1, createdAt: -1 });

const ReelComment = mongoose.models.ReelComment || mongoose.model('ReelComment', reelCommentSchema);
export default ReelComment;
