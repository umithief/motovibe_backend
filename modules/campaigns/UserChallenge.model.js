import mongoose from 'mongoose';

const userChallengeSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    campaign: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Campaign',
        required: true,
    },
    currentMetric: { type: Number, default: 0 }, // km ridden, count, etc.
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
    rewardClaimed: { type: Boolean, default: false },
    claimedAt: { type: Date },
}, { timestamps: true, versionKey: false });

// A user can join each campaign only once
userChallengeSchema.index({ user: 1, campaign: 1 }, { unique: true });

const UserChallenge = mongoose.models.UserChallenge || mongoose.model('UserChallenge', userChallengeSchema);
export default UserChallenge;
