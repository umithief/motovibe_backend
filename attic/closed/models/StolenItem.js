import mongoose from 'mongoose';

const stolenItemSchema = new mongoose.Schema({
    serialNumber: { type: String, required: true },
    brand: String,
    model: String,
    category: String,
    dateStolen: String,
    city: String,
    contactInfo: String,
    description: String,
    status: { type: String, default: 'stolen' },
    dateReported: { type: String, default: () => new Date().toLocaleDateString('tr-TR') },
    image: String
}, { versionKey: false });

const StolenItem = mongoose.models.StolenItem || mongoose.model('StolenItem', stolenItemSchema);

export default StolenItem;
