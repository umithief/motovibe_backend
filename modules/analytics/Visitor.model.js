import mongoose from 'mongoose';

const visitorSchema = new mongoose.Schema({
    date: { type: String, required: true },
    count: { type: Number, default: 0 }
}, { versionKey: false });
const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', visitorSchema);

export default Visitor;
