import mongoose from 'mongoose';

const geoPoiSchema = new mongoose.Schema({
    source: { type: String, required: true, trim: true, index: true },
    sourceId: { type: String, required: true, trim: true },
    name: { type: String, trim: true, default: '' },
    normalizedName: { type: String, trim: true, default: '', index: true },
    category: {
        type: String,
        required: true,
        enum: ['fuel', 'motorcycle_service', 'motorcycle_shop', 'parking', 'cafe', 'restaurant', 'camp', 'viewpoint', 'hotel', 'hospital', 'pharmacy', 'police', 'tourism', 'water', 'toilet', 'other'],
        index: true
    },
    location: {
        type: { type: String, enum: ['Point'], required: true, default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    attribution: { type: [String], default: [] },
    importedAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });

geoPoiSchema.index({ source: 1, sourceId: 1 }, { unique: true });
geoPoiSchema.index({ location: '2dsphere' });
geoPoiSchema.index({ category: 1, location: '2dsphere' });

export default mongoose.models.GeoPoi || mongoose.model('GeoPoi', geoPoiSchema);
