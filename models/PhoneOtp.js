import mongoose from 'mongoose';

const phoneOtpSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        index: true,
        trim: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    otpHash: {
        type: String,
        required: true,
        select: false
    },
    attempts: { type: Number, default: 0, select: false },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 }
    },
}, {
    timestamps: true
});

const PhoneOtp = mongoose.models.PhoneOtp || mongoose.model('PhoneOtp', phoneOtpSchema);
export default PhoneOtp;
