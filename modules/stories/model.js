import mongoose from 'mongoose';

const storySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    mediaUrl: {
        type: String,
        required: true
    },
    mediaType: {
        type: String,
        enum: ['IMAGE', 'VIDEO'],
        default: 'IMAGE'
    },
    caption: {
        type: String,
        trim: true,
        default: ''
    },
    location: {
        type: String,
        trim: true,
        default: ''
    },
    bikeModel: {
        type: String,
        trim: true,
        default: ''
    },
    privacy: {
        type: String,
        enum: ['PUBLIC', 'FOLLOWERS'],
        default: 'PUBLIC'
    },
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    reactions: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        emoji: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    views: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: () => new Date(+new Date() + 24 * 60 * 60 * 1000), // 24 hours from now
        index: { expires: '0s' } // TTL index
    }
}, {
    timestamps: true
});

export default mongoose.models.Story || mongoose.model('Story', storySchema);
