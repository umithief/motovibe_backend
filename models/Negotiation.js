import mongoose from 'mongoose';

const negotiationSchema = new mongoose.Schema({
    productId: Number,
    productName: String,
    productImage: String,
    originalPrice: Number,
    offerPrice: Number,
    userId: String,
    userName: String,
    status: { type: String, default: 'pending' },
    date: { type: String, default: () => new Date().toLocaleDateString('tr-TR') }
}, { versionKey: false });

const Negotiation = mongoose.models.Negotiation || mongoose.model('Negotiation', negotiationSchema);

export default Negotiation;
