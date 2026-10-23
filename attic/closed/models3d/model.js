import mongoose from 'mongoose';

const model3dSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    poster: { type: String, required: true },
    category: String
}, { versionKey: false });

const Model3D = mongoose.models.Model3D || mongoose.model('Model3D', model3dSchema);

export default Model3D;
