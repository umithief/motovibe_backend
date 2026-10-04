import mongoose from 'mongoose';

const feedbackSchema = new mongoose.Schema({
    userId: String,
    userName: String,
    type: String,
    rating: Number,
    message: String,
    date: String,
    status: { type: String, default: 'new' }
}, { versionKey: false });

const Feedback = mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema);

export default Feedback;
