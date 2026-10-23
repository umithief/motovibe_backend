import mongoose from 'mongoose';

// Comment schema moved to separate model

export const MAX_MEDIA_TAGS = 20;

// Cyber-Lens spatial tag. x/y are percentages of the media box (top-left origin).
// Tagged user's public identity is cached (like userName/userAvatar below) so
// feed queries can render tag pills without an extra populate.
const mediaTagSchema = new mongoose.Schema({
    taggedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, trim: true },
    name: { type: String, trim: true },
    avatar: String,
    isApexPro: { type: Boolean, default: false },
    taggedBike: { type: String, trim: true, maxlength: 80 },
    x: { type: Number, required: true, min: 0, max: 100 },
    y: { type: Number, required: true, min: 0, max: 100 },
    mediaIndex: { type: Number, default: 0, min: 0 },
    // Visible in the tagged user's "Etiketlenenler" tab.
    isApproved: { type: Boolean, default: true }
}, { _id: true });

const uniqueTagPerMedia = (tags) => {
    const seen = new Set();
    return tags.every((tag) => {
        const key = `${tag.mediaIndex || 0}:${tag.taggedUser}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};


const postSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Cache user details for feed performance
    userName: String,
    userAvatar: String,
    userRank: String,
    bikeModel: String,

    caption: { type: String, trim: true }, // content -> caption alias or replacement? User asked for 'caption'. I will keep 'content' as alias or just use caption. Let's use caption and map content to it if needed? The user said "caption (String)".
    // Backward compatibility:
    content: { type: String, trim: true },

    tags: {
        type: [String],
        default: []
    },

    // Media Objects
    media: [{
        url: { type: String, required: true },
        type: { type: String, enum: ['IMAGE', 'VIDEO'], default: 'IMAGE' },
        isHudOverlayActive: { type: Boolean, default: false },
        width: { type: Number, min: 1 },
        height: { type: Number, min: 1 },
        aspectRatio: { type: Number, min: 0.05, max: 20 }
    }],

    // Legacy support
    images: [String],
    mediaUrl: { type: String },

    // Cyber-Lens tagging
    mediaTags: {
        type: [mediaTagSchema],
        default: [],
        validate: [
            { validator: (tags) => tags.length <= MAX_MEDIA_TAGS, message: `Bir gönderide en fazla ${MAX_MEDIA_TAGS} etiket olabilir.` },
            { validator: uniqueTagPerMedia, message: 'Aynı sürücü aynı medyada birden fazla etiketlenemez.' }
        ]
    },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Engagement
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Meta
    location: String,

    // Telemetry Data (Embedded Object)
    telemetry: {
        speed: Number,
        leanAngle: Number,
        gForce: Number,
        locationLabel: String,
        // Legacy rideStats mapping
        distance: Number,
        duration: String
    },

    // Legacy Ride Stats Integration (keeping for backward compatibility or mapping)
    rideStats: {
        maxSpeed: Number,
        distance: Number,
        duration: String,
        leanAngle: Number,
        routeSvg: String,
        rideId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' }
    },

    // References
    linkedBike: { type: mongoose.Schema.Types.ObjectId, ref: 'Bike' },
    linkedRoute: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },

    // Counters (managed via hooks or controllers for perf)
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },

    // VibeEngine Scoring Signals
    cachedScore: { type: Number, default: 0, index: true },
    telemetryQuality: { type: Boolean, default: false },

    // Privacy & Soft Delete
    isDeleted: { type: Boolean, default: false, index: true },
    visibility: {
        type: String,
        enum: ['PUBLIC', 'FOLLOWERS', 'PRIVATE', 'DELETED'],
        default: 'PUBLIC',
        index: true
    }
}, {
    timestamps: true,
    versionKey: false
});

// Indexes for feed performance
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ isDeleted: 1, createdAt: -1 }); // Soft delete feed filter
postSchema.index({ createdAt: -1 }); // Critical for Explore global timeline
postSchema.index({ likeCount: -1, createdAt: -1 }); // Compound index for Trending + Discovery feed
postSchema.index({ tags: 1, createdAt: -1 }); // Quick category/tag lookup
postSchema.index({ 'mediaTags.taggedUser': 1, createdAt: -1 }); // "Etiketlenenler" tab
postSchema.index({ mentions: 1, createdAt: -1 });

// Virtual for caption/content compatibility
postSchema.virtual('displayContent').get(function () {
    return this.caption || this.content;
});

postSchema.index({isDeleted:1,createdAt:-1,_id:-1});
const Post = mongoose.models.SocialPost || mongoose.model('SocialPost', postSchema);
export default Post;
