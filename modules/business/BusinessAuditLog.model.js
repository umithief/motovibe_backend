import mongoose from 'mongoose';

const businessAuditLogSchema = new mongoose.Schema({
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: {
        type: String,
        enum: [
            'APPOINTMENT_STATUS_CHANGED',
            'TAX_ID_UPDATED',
            'TAX_ID_ACCESSED'
        ],
        required: true
    },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });

businessAuditLogSchema.index({ businessId: 1, createdAt: -1 });

const BusinessAuditLog = mongoose.models.BusinessAuditLog ||
    mongoose.model('BusinessAuditLog', businessAuditLogSchema);

export default BusinessAuditLog;
