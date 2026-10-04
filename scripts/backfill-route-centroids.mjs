import 'dotenv/config';
import mongoose from 'mongoose';

const isApply = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    throw new Error('MONGO_URI ortam değişkeni zorunludur.');
}

const validPoint = (lat, lng) =>
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

const routePoints = (route) => {
    if (Array.isArray(route.path?.coordinates)) {
        return route.path.coordinates
            .map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
            .filter(({ lat, lng }) => validPoint(lat, lng));
    }

    if (Array.isArray(route.coordinates)) {
        return route.coordinates
            .map((point) => ({
                lat: Number(point?.lat ?? point?.latitude),
                lng: Number(point?.lng ?? point?.longitude),
            }))
            .filter(({ lat, lng }) => validPoint(lat, lng));
    }

    return [];
};

const centroidFor = (points) => {
    if (points.length === 0) return null;
    const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
    return validPoint(lat, lng)
        ? { type: 'Point', coordinates: [lng, lat] }
        : null;
};

try {
    await mongoose.connect(mongoUri);
    const routes = mongoose.connection.collection('routes');
    const cursor = routes.find({
        $or: [
            { centroid: { $exists: false } },
            { 'centroid.coordinates.0': { $exists: false } },
            { 'centroid.coordinates.1': { $exists: false } },
        ],
    });

    let scanned = 0;
    let eligible = 0;
    let skipped = 0;
    for await (const route of cursor) {
        scanned += 1;
        const centroid = centroidFor(routePoints(route));
        if (!centroid) {
            skipped += 1;
            continue;
        }
        eligible += 1;
        if (isApply) {
            await routes.updateOne({ _id: route._id }, { $set: { centroid } });
        }
    }

    console.log(JSON.stringify({
        mode: isApply ? 'apply' : 'dry-run',
        scanned,
        eligible,
        skipped,
    }));
} finally {
    await mongoose.disconnect();
}
