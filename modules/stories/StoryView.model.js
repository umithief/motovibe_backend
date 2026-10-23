import mongoose from 'mongoose';

const storyViewSchema = new mongoose.Schema({
    storyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story',
        required: true,
        index: true
    },
    viewerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    viewedAt: {
        type: Date,
        default: Date.now
    }
});

// Prevent duplicate views
storyViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true });

export default mongoose.models.StoryView || mongoose.model('StoryView', storyViewSchema);
