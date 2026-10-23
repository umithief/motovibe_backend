import mongoose from 'mongoose';

const poiSchema = new mongoose.Schema({
    location: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number] } // [longitude, latitude]
    },
    type: {
        type: String,
        enum: [
            'CAFE',
            'VIEWPOINT',
            'GAS_STATION',
            'PHOTO_OP',
            'FUEL',
            'MOTORCYCLE_SERVICE',
            'MOTORCYCLE_SHOP',
            'PARKING',
            'RESTAURANT',
            'CAMP',
            'CAMPSITE',
            'HOTEL',
            'TOURISM'
        ],
        required: true
    },
    note: { type: String }
}, { _id: false });

const routeSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true },
    description: String,

    // GeoJSON exact map path
    path: {
        type: { type: String, enum: ['LineString'] },
        coordinates: { type: [[Number]] } // Array of [longitude, latitude] arrays
    },

    // Query anchor for Explore. LineString is retained for rendering; $near
    // operates reliably on a Point index rather than a full route geometry.
    centroid: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number] } // [longitude, latitude]
    },

    // POIs specific to the biker route
    pois: [poiSchema],

    // Fallback/Legacy map data
    coordinates: [{ lat: Number, lng: Number }],
    waypoints: [{ type: String }],

    distance: String,
    distanceMeters: Number,
    durationSeconds: Number,
    photos: [{ type: String }],
    image: String, // Hero cover
    difficulty: String,
    estimatedTime: String,
    location: String,
    bestSeason: String,
    tags: [String],
    rating: { type: Number, default: 0 },
    riderCount: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false, index: true },
    isAIGenerated: { type: Boolean, default: false },
    stats: {
        curves: Number,
        roadQuality: Number,
        traffic: Number
    },
    terrain: { type: [String], default: [] },
    difficultyMetrics: {
        technical: { type: Number, min: 1, max: 5 },
        scenery: { type: Number, min: 1, max: 5 },
        speed: { type: Number, min: 1, max: 5 }
    },
    reviews: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rating: { type: Number, required: true },
        comment: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
    }]
}, { versionKey: false, timestamps: true });

// 2dsphere indexing for intersecting queries
routeSchema.index({ path: '2dsphere' });
routeSchema.index({ centroid: '2dsphere' });

routeSchema.index({"isDeleted":1,"createdAt":-1,"_id":-1});
const Route = mongoose.models.Route || mongoose.model('Route', routeSchema);

export default Route;
