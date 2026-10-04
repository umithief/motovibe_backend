import mongoose from 'mongoose';

const SponsoredAdSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: false
  },
  adType: {
    type: String,
    enum: ['biz', 'user'],
    default: 'user'
  },
  businessName: {
    type: String,
    default: 'MotoVibe BİZ Partner'
  },
  businessProfilePic: {
    type: String,
    default: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=500'
  },
  mediaUrls: {
    type: [String],
    required: true,
    validate: [arr => arr && arr.length > 0, 'Reklam en az bir medya içermelidir.']
  },
  caption: {
    type: String,
    trim: true,
    maxLength: 500,
    default: ''
  },
  ctaText: {
    type: String,
    enum: ['Detaylı Bilgi', 'Satın Al', 'Randevu Al'],
    default: 'Detaylı Bilgi'
  },
  ctaLink: {
    type: String,
    required: true,
    default: 'https://motovibe.app'
  },
  targetAudience: {
    minCcRequirement: { type: Number, default: 0 },
    cities: [String]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  payment: {
    packageId: {
      type: String,
      enum: ['starter', 'pro', 'biz_garaj', 'enterprise'],
      default: 'starter'
    },
    packageName: {
      type: String,
      default: 'Başlangıç Paketi'
    },
    amount: {
      type: Number,
      default: 199
    },
    currency: {
      type: String,
      default: 'TRY'
    },
    targetImpressions: {
      type: Number,
      default: 1000
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'paid'
    },
    paymentMethod: {
      type: String,
      default: 'credit_card'
    },
    transactionId: String,
    paidAt: Date
  },
  metrics: {
    impressions: { type: Number, default: 0 },
    uniqueReach: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 }
  },
  viewerLogs: [
    {
      identifier: { type: String, required: true },
      viewedAt: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

export default mongoose.model('SponsoredAd', SponsoredAdSchema);
