import mongoose from 'mongoose';

const businessSettlementSchema = new mongoose.Schema({
    settlementNumber: { type: String, required: true, unique: true, index: true },
    businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    appointmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Appointment',
        required: true,
        unique: true
    },
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    itemName: { type: String, required: true, maxlength: 120 },
    currency: { type: String, enum: ['TRY'], default: 'TRY' },
    grossAmount: { type: Number, min: 0, required: true },
    commissionRate: { type: Number, min: 0, max: 30, required: true },
    commissionAmount: { type: Number, min: 0, required: true },
    netAmount: { type: Number, min: 0, required: true },
    status: {
        type: String,
        enum: ['pending', 'paid', 'cancelled', 'refunded'],
        default: 'pending',
        index: true
    },
    paidAt: Date,
    externalPaymentId: { type: String, select: false },
    paymentProvider: { type: String, enum: ['iyzico'], select: false },
    paymentToken: { type: String, select: false },
    paymentConversationId: { type: String, select: false },
    checkoutExpiresAt: { type: Date, select: false }
}, { timestamps: true });

businessSettlementSchema.index({ businessId: 1, createdAt: -1 });

const BusinessSettlement = mongoose.model(
    'BusinessSettlement',
    businessSettlementSchema
);
export default BusinessSettlement;
