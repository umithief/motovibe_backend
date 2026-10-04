import mongoose from 'mongoose';

const highlightItemSchema = new mongoose.Schema({
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
    storyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const highlightSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 60
    },
    coverUrl: {
        type: String,
        default: ''
    },
    items: [highlightItemSchema],
    isPro: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

const Highlight = mongoose.model('Highlight', highlightSchema);
export default Highlight;
