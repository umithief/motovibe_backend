import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, required: true },
    image: { type: String, required: true },
    desc: String,
    count: String,
    className: String
}, { versionKey: false });

const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);

export default Category;
