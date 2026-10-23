
import mongoose from 'mongoose';

const uiSettingSchema = new mongoose.Schema({
    component: { type: String, required: true, unique: true }, // e.g., 'VibeButton'
    config: { type: Object, required: true }, // Flexible JSON storage for settings
    updatedAt: { type: Date, default: Date.now },
    updatedBy: String
}, { versionKey: false });

const UISetting = mongoose.models.UISetting || mongoose.model('UISetting', uiSettingSchema);

export default UISetting;
