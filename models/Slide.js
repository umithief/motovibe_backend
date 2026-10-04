import mongoose from 'mongoose';

const slideSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    subtitle: {
        type: String,
        default: ''
    },
    imageUrl: {
        type: String,
        required: true
    },
    actionLabel: {
        type: String,
        default: ''
    },
    actionType: {
        type: String,
        enum: ['ride', 'route', 'post', 'product', 'shop', 'url', 'none'],
        default: 'none'
    },
    actionTarget: {
        type: String, // ID of the target or URL
        default: ''
    },
    accentColor: {
        type: String,
        default: '#D4AF37' // MotoVibe brand gold
    },
    order: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    startDate: {
        type: Date,
        default: null
    },
    endDate: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Only return active slides that are within date range
slideSchema.statics.getActiveSlides = async function () {
    const now = new Date();
    return this.find({
        isActive: true,
        $or: [
            { startDate: null, endDate: null },
            { startDate: { $lte: now }, endDate: null },
            { startDate: null, endDate: { $gte: now } },
            { startDate: { $lte: now }, endDate: { $gte: now } }
        ]
    }).sort({ order: 1 });
};

const Slide = mongoose.model('Slide', slideSchema);

export default Slide;
