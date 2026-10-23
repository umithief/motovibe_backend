import mongoose from 'mongoose';

const packSignalSchema = new mongoose.Schema({
    pack: { type: mongoose.Schema.Types.ObjectId, ref: 'Pack', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
        type: String,
        enum: ['ANNOUNCEMENT', 'RIDE_REQUEST', 'SOS', 'CHECK_IN'],
        default: 'ANNOUNCEMENT'
    },
    content: { type: String, required: true },
    coordinates: {
        type: [Number], // [lng, lat]
        index: '2dsphere'
    },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, {
    timestamps: true
});

const PackSignal = mongoose.model('PackSignal', packSignalSchema);
export default PackSignal;
