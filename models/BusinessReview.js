import mongoose from 'mongoose';

const businessReviewSchema = new mongoose.Schema({
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
        required: true
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500 }
}, { timestamps: true });

businessReviewSchema.index({ businessId: 1, customerId: 1 }, { unique: true });
businessReviewSchema.index({ businessId: 1, createdAt: -1 });

const BusinessReview = mongoose.model('BusinessReview', businessReviewSchema);
export default BusinessReview;
