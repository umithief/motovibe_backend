import mongoose from 'mongoose';

const packPostSchema = new mongoose.Schema({
    pack: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pack',
        required: true,
        index: true,
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    content: {
        type: String,
        trim: true,
        maxlength: [2000, 'Gönderi 2000 karakteri aşamaz'],
        default: '',
    },
    image: {
        type: String,
        default: '',
    },
    postType: {
        type: String,
        enum: ['TEXT', 'PHOTO', 'ROUTE', 'BIKE', 'LIVE_MAP'],
        default: 'TEXT',
    },
    // Rich Attachments
    attachedRoute: {
        routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
        name: String,
        distance: String,
        previewImage: String,
    },
    attachedBike: {
        brand: String,
        model: String,
        image: String,
        cc: String,
        hp: String,
    },
    attachedMap: {
        lat: Number,
        lng: Number,
        locationLabel: String,
        speed: Number,
    },
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    likeCount: {
        type: Number,
        default: 0,
    },
    comments: [{
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        text: {
            type: String,
            trim: true,
            maxlength: [500, 'Yorum 500 karakteri aşamaz'],
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    }],
    commentCount: {
        type: Number,
        default: 0,
    },
    isPinned: {
        type: Boolean,
        default: false,
    },
    isAnnouncement: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true,
    versionKey: false,
});

packPostSchema.index({ pack: 1, isPinned: -1, createdAt: -1 });
packPostSchema.index({ pack: 1, createdAt: -1 });

const PackPost = mongoose.models.PackPost || mongoose.model('PackPost', packPostSchema);
export default PackPost;
