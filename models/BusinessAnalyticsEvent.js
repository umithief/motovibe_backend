import mongoose from 'mongoose';

const businessAnalyticsEventSchema = new mongoose.Schema({
    businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    eventType: {
        type: String,
        enum: ['PROFILE_VIEW', 'CATALOG_VIEW', 'CATALOG_ITEM_CLICK'],
        required: true
    },
    catalogItemId: { type: mongoose.Schema.Types.ObjectId },
    dayBucket: { type: String, required: true }
}, { timestamps: true });

businessAnalyticsEventSchema.index(
    { businessId: 1, actorId: 1, eventType: 1, catalogItemId: 1, dayBucket: 1 },
    { unique: true }
);
businessAnalyticsEventSchema.index({ businessId: 1, createdAt: -1 });

const BusinessAnalyticsEvent = mongoose.model(
    'BusinessAnalyticsEvent',
    businessAnalyticsEventSchema
);
export default BusinessAnalyticsEvent;
