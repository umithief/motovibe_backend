import mongoose from 'mongoose';

// `members` stays readable during the staged migration. New authorization and
// writes use `memberRoles`, which has an explicit role and join timestamp.
const packMemberRoleSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    role: {
        type: String,
        enum: ['leader', 'admin', 'moderator', 'member', 'prospect'],
        default: 'member',
    },
    joinedAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: false });

const packSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Pack name is required'],
        unique: true,
        trim: true,
        maxlength: [50, 'Name cannot be more than 50 characters']
    },
    // Legacy compatibility field. New UI no longer requires a tag-based identity.
    tag: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: [10, 'Tag cannot be more than 10 characters'],
        default: ''
    },
    description: {
        type: String,
        maxlength: [500, 'Description cannot be more than 500 characters'],
        default: ''
    },
    coverImage: {
        type: String,
        default: 'default-pack-cover.jpg'
    },
    leaderProfile: {
        avatar: {
            type: String,
            default: '',
        },
        coverImage: {
            type: String,
            default: '',
        },
    },
    // Legacy compatibility field for older list components.
    emblem: {
        type: String,
        default: 'default-pack-emblem.png'
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    admins: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    // Canonical role-bearing membership. The legacy `members`, `admins` and
    // `joinRequests` fields are only retained until the explicit migration has
    // been applied and verified on the target database.
    memberRoles: {
        type: [packMemberRoleSchema],
        default: [],
    },
    joinRequests: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        requestedAt: {
            type: Date,
            default: Date.now,
        },
    }],
    memberCount: {
        type: Number,
        default: 0,
    },
    rules: {
        type: String,
        maxlength: [1000, 'Kurallar 1000 karakteri aşamaz'],
        default: '',
    },
    garageStats: {
        totalCC: {
            type: Number,
            default: 0
        },
        totalHP: {
            type: Number,
            default: 0
        },
        bikeCount: {
            type: Number,
            default: 0
        }
    },
    globalRank: {
        type: Number,
        default: 0
    },
    upcomingRides: [{
        routeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Route',
            default: null
        },
        routeName: {
            type: String,
            trim: true,
            required: true
        },
        startsAt: {
            type: Date,
            required: true
        },
        pace: {
            type: String,
            enum: ['Sakin', 'Tur', 'Tempolu', 'Sport'],
            default: 'Tempolu'
        },
        attendeeIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }],
        // Sürüş kapak görseli (yüklenmiş medya URL'si)
        image: {
            type: String,
            trim: true,
            maxlength: 2048,
            default: ''
        },
        // Buluşma noktası (serbest metin)
        location: {
            type: String,
            trim: true,
            maxlength: 160,
            default: ''
        },
        isActive: {
            type: Boolean,
            default: true
        }
    }],
    // These fields stay to avoid breaking admin pages and existing filters.
    isPrivate: {
        type: Boolean,
        default: false
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    location: {
        type: String, // E.g., 'Istanbul', 'Izmir'
        default: ''
    },
    winRate: {
        type: Number,
        default: 50.0
    },
    tier: {
        type: String,
        default: 'BÖLGESEL BİRİNCİ LİG LİDERİ'
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    // Recoverable removal: deleted packs are excluded from every normal query.
    isDeleted: {
        type: Boolean,
        default: false,
        index: true,
    },
    deletedAt: {
        type: Date,
        default: null,
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for faster queries
packSchema.index({ tag: 1 });
packSchema.index({ members: 1 });
packSchema.index({ 'memberRoles.user': 1 });
packSchema.index({ 'joinRequests.user': 1 });
packSchema.index({ globalRank: 1 });
packSchema.index({ 'garageStats.totalCC': -1, 'garageStats.totalHP': -1 });

const Pack = mongoose.models.Pack || mongoose.model('Pack', packSchema);
export default Pack;
