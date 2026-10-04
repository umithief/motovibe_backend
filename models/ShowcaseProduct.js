import mongoose from 'mongoose';

const showcaseProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    price: { type: Number, required: true },
    category: String,
    image: String,
    images: [String],
    rating: { type: Number, default: 0 },
    features: [String],
    stock: { type: Number, default: 0 },
    isNegotiable: { type: Boolean, default: false }
}, { versionKey: false });

const ShowcaseProduct = mongoose.models.ShowcaseProduct || mongoose.model('ShowcaseProduct', showcaseProductSchema);

export default ShowcaseProduct;
