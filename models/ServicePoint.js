import mongoose from 'mongoose';

const servicePointSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: String,
    categoryLabel: String,
    description: String,
    address: String,
    city: String,
    phone: String,
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },
    image: String,
    coordinates: { lat: Number, lng: Number },
    brands: [String]
}, { versionKey: false });
const ServicePoint = mongoose.models.ServicePoint || mongoose.model('ServicePoint', servicePointSchema);

export default ServicePoint;
