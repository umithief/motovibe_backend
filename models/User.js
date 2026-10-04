import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, unique: true, trim: true, lowercase: true, sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    avatar: { type: String, default: 'default-avatar.png' },
    bio: { type: String, maxlength: 150 },

    // User Type & Business Profile (MotoVibe BİZ)
    userType: {
        type: String,
        enum: ['INDIVIDUAL', 'PROFESSIONAL'],
        default: 'INDIVIDUAL'
    },
    activeProfileMode: {
        type: String,
        enum: ['PERSONAL', 'PROFESSIONAL'],
        default: 'PERSONAL'
    },
    businessProfile: {
        category: {
            type: String,
            enum: ['SERVICE', 'STORE', 'CAFE', 'RENTAL', 'INFLUENCER']
        },
        businessName: { type: String, maxlength: 80 },
        businessDescription: { type: String, maxlength: 300 },
        businessPhone: { type: String, maxlength: 20 },
        businessSocials: {
            instagram: { type: String },
            website: { type: String },
            whatsapp: { type: String }
        },
        verifiedBadge: { type: Boolean, default: false },
        ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
        ratingCount: { type: Number, min: 0, default: 0 },
        acceptsAppointments: { type: Boolean, default: true },
        workingHours: [{
            day: String,
            open: String,
            close: String,
            isClosed: { type: Boolean, default: false }
        }],
        address: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] },
            label: { type: String, maxlength: 160 }
        },
        services: [{ type: String }],
        catalogItems: [{
            name: { type: String, maxlength: 80 },
            category: { type: String, maxlength: 40 },
            price: { type: Number, min: 0 },
            discountPrice: { type: Number, min: 0 },
            durationMin: { type: Number, min: 15, max: 480, default: 60 },
            apexBonus: { type: Number, min: 0, default: 0 },
            stock: { type: Number, min: 0, default: 0 },
            imageUrl: { type: String, maxlength: 400 },
            description: { type: String, maxlength: 280 },
            isActive: { type: Boolean, default: true }
        }],
        flashOffers: [{
            offerId: { type: String, maxlength: 64 },
            title: { type: String, maxlength: 80 },
            description: { type: String, maxlength: 220 },
            discountRate: { type: Number, min: 0, max: 95 },
            targetRadiusKm: { type: Number, min: 1, max: 300, default: 20 },
            validUntil: { type: Date },
            isActive: { type: Boolean, default: true },
            createdAt: { type: Date, default: Date.now }
        }],
        taxId: { type: String, select: false },
        iyzicoSubMerchantKey: { type: String, select: false }
    },

    isAdmin: { type: Boolean, default: false },
    joinDate: { type: String, default: () => new Date().toLocaleDateString('tr-TR') },
    phone: String,
    emergencyPhone: String,
    pushTokens: [{
        _id: false,
        token: { type: String, required: true, maxlength: 512 },
        platform: { type: String, enum: ['android', 'ios', 'web', 'unknown'], default: 'unknown' },
        updatedAt: { type: Date, default: Date.now }
    }],
    address: String,
    points: { type: Number, default: 0 },
    rank: { type: String, default: 'Çaylak Sürücü' },
    bikeModel: { type: String },
    primaryBike: { type: String },
    location: { type: String },

    // Riding Pace (Matchmaking)
    ridingPace: {
        type: String,
        enum: ['CHILL', 'TOURING', 'SPORT', 'TRACK'],
        default: null
    },

    trophyBadges: [{
        key: { type: String },
        title: { type: String },
        category: { type: String },
        rank: { type: Number },
        score: { type: Number },
        weekOf: { type: String },
        awardedAt: { type: Date, default: Date.now }
    }],

    // Vibe-SOS location tracking
    lastCoordinates: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number] }
    },

    coverImage: { type: String },

    // Rich Bio Blocks
    bioBlocks: {
        type: [mongoose.Schema.Types.Mixed],
        default: []
    },

    // Garage
    garage: [{
        brand: { type: String, required: true, trim: true, maxlength: 60 },
        model: { type: String, required: true, trim: true, maxlength: 60 },
        year: { type: Number, min: 1900, max: 2100 },
        image: { type: String, default: null },
        km: { type: Number, min: 0, default: 0 },
        color: { type: String, trim: true, maxlength: 40 },
        cc: { type: Number, min: 0 },
        hp: { type: Number, min: 0 },
        style: {
            type: String,
            enum: ['NAKED', 'RACING', 'ENDURO', 'CHOPPER', 'SCOOTER', 'TOURING', 'ADVENTURE', 'CRUISER', 'SPORT', 'CUSTOM', 'UNKNOWN'],
            default: 'UNKNOWN'
        },
        isPrimary: { type: Boolean, default: false },
        verificationImage: { type: String, default: null },
        verificationStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
        isVerified: { type: Boolean, default: false },
        maintenanceRecords: [{
            title: { type: String, required: true, trim: true, maxlength: 100 },
            km: { type: Number, min: 0 },
            cost: { type: Number, min: 0 },
            serviceName: { type: String, trim: true, maxlength: 100 },
            description: { type: String, trim: true, maxlength: 300 },
            date: { type: Date, default: Date.now },
            createdAt: { type: Date, default: Date.now }
        }],
        createdAt: { type: Date, default: Date.now }
    }],

    // Shopping Cart
    cart: [{
        productId: String,
        name: String,
        price: Number,
        image: String,
        quantity: { type: Number, default: 1 }
    }],

    // Social Graph
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialPost' }],
    savedRoutes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Route' }],
    savedReels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Reel' }],

    // Asfalt Kıdemi
    isFounder: { type: Boolean, default: false },

    // PRO Subscription
    isPremium: { type: Boolean, default: false },
    isPro: { type: Boolean, default: false },
    proExpiryDate: { type: Date },
    revenueCatId: { type: String, sparse: true },

    // PRO Features
    isGhostMode: { type: Boolean, default: false },

    // Privacy & Notifications
    privacy: {
        isPrivate: { type: Boolean, default: false },
        hideLocation: { type: Boolean, default: false }
    },
    notifications: {
        likes: { type: Boolean, default: true },
        comments: { type: Boolean, default: true },
        follows: { type: Boolean, default: true },
        packs: { type: Boolean, default: true },
        appointments: { type: Boolean, default: true },
        rides: { type: Boolean, default: true },
        achievements: { type: Boolean, default: true },
        pushEnabled: { type: Boolean, default: true }
    },

    // Spotify
    spotifyRefreshToken: { type: String, select: false },

    // Verification
    isVerified: { type: Boolean, default: false },
    verificationStatus: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
    },

    // Cockpit Illumination (Dynamic Custom Vibe)
    preferences: {
        accentColor: {
            type: String,
            default: '#E2FF3B',
            validate: {
                validator: function(v) {
                    return /^#[0-9A-Fa-f]{6}$/.test(v);
                },
                message: props => `${props.value} geçerli bir hex renk kodu değil!`
            }
        }
    },

    // VibeEngine Signals
    interestVector: [{ type: String }],
    lastActiveGarageId: { type: String },
    onboardingComplete: { type: Boolean, default: false },
    totalKm: { type: Number, default: 0 },
    topSpeed: { type: Number, default: 0 },
    postsCount: { type: Number, default: 0 },
    expenses: [{
        type: { type: String, enum: ['FUEL', 'GEAR', 'MAINTENANCE'] },
        amount: Number,
        liters: Number,
        odometer: Number,
        date: Date
    }],
    unlockedAchievements: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Achievement'
    }],
    achievementProgress: {
        type: Map,
        of: Number,
        default: {}
    },
    visitedCities: [{
        type: String
    }],

    // Authentication sessions and password recovery secrets are never exposed.
    tokenVersion: { type: Number, default: 0, select: false },
    refreshSessions: {
        type: [{
            _id: false,
            familyId: { type: String, required: true },
            tokenHash: { type: String, required: true },
            createdAt: { type: Date, required: true },
            expiresAt: { type: Date, required: true },
        }],
        default: [],
        select: false,
    },

    // Password Reset
    resetPasswordOTPHash: { type: String, select: false },
    resetPasswordNonce: { type: String, select: false },
    resetPasswordAttempts: { type: Number, default: 0, select: false },
    resetPasswordExpires: { type: Date, select: false },

    // Phone Verification
    isPhoneVerified: { type: Boolean, default: false },

    // Account Deletion & GDPR
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    versionKey: false
});

// Helper to check password
userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
    return await bcrypt.compare(candidatePassword, userPassword);
};

// Enforce verification status consistency and clean up incomplete geo data
userSchema.pre('save', function () {
    if (this.isModified('verificationStatus') || this.isModified('isVerified')) {
        this.isVerified = this.verificationStatus === 'approved';
    }

    if (this.garage && Array.isArray(this.garage)) {
        this.garage.forEach(bike => {
            bike.isVerified = (bike.verificationStatus === 'approved');
        });
    }

    if (this.userType !== 'PROFESSIONAL') {
        this.activeProfileMode = 'PERSONAL';
    } else if (!this.activeProfileMode) {
        this.activeProfileMode = 'PROFESSIONAL';
    }

    if (this.lastCoordinates && (!this.lastCoordinates.type || !this.lastCoordinates.coordinates || this.lastCoordinates.coordinates.length === 0)) {
        this.lastCoordinates = undefined;
    }
});

// Indexes
userSchema.index({ isAdmin: 1 });
userSchema.index(
    { phone: 1 },
    {
        unique: true,
        partialFilterExpression: {
            isPhoneVerified: true,
            phone: { $type: 'string' },
        },
    },
);
userSchema.index({ 'refreshSessions.tokenHash': 1 });
userSchema.index({ 'refreshSessions.familyId': 1 });
userSchema.index({ lastCoordinates: '2dsphere' });
userSchema.index({ 'businessProfile.address': '2dsphere' });

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
