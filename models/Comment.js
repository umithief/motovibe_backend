import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
    content: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialPost', required: true },
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    versionKey: false
});

// Index for fast lookups by post
commentSchema.index({ post: 1, createdAt: 1 });

const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
export default Comment;
