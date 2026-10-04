import mongoose from 'mongoose';

const clanWarSchema = new mongoose.Schema({
    clanA: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pack',
        required: true
    },
    clanB: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pack',
        required: true
    },
    scoreA: {
        type: Number,
        default: 0
    },
    scoreB: {
        type: Number,
        default: 0
    },
    endTime: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

const ClanWar = mongoose.models.ClanWar || mongoose.model('ClanWar', clanWarSchema);
export default ClanWar;
