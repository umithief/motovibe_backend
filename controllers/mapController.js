import Route from '../models/Route.js';
import User from '../models/User.js';
import RideBeacon from '../models/Beacon.js';
import catchAsync from '../utils/catchAsync.js';

const _legacyRouteAnchor = (route) => {
    const coordinates = Array.isArray(route.coordinates) ? route.coordinates : [];
    if (coordinates.length) {
        const lat = coordinates.reduce((sum, point) => sum + Number(point.lat), 0) / coordinates.length;
        const lng = coordinates.reduce((sum, point) => sum + Number(point.lng), 0) / coordinates.length;
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    const path = route.path?.coordinates;
    if (!Array.isArray(path) || !path.length) return null;
    const lng = path.reduce((sum, point) => sum + Number(point?.[0]), 0) / path.length;
    const lat = path.reduce((sum, point) => sum + Number(point?.[1]), 0) / path.length;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const _metersBetween = (from, to) => {
    const radians = (value) => value * Math.PI / 180;
    const latDelta = radians(to.lat - from.lat);
    const lngDelta = radians(to.lng - from.lng);
    const a = Math.sin(latDelta / 2) ** 2 +
        Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// @desc    Explore map routes based on bounding box / location
// @route   GET /api/routes/explore
// @access  Public
export const exploreMapRoutes = catchAsync(async (req, res) => {
    const { lat, lng, radius = 50000 } = req.query; // Default 50km
    const latitude = Number(lat);
    const longitude = Number(lng);
    const maxDistance = Math.min(Math.max(Number(radius) || 50000, 1000), 200000);
    const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude) &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

    if (!hasLocation) {
        const routes = await Route.find({}).limit(20).lean();
        return res.status(200).json({ status: 'success', data: { routes } });
    }

    const routes = await Route.find({
        centroid: {
            $near: {
                $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                $maxDistance: maxDistance
            }
        }
    }).limit(20).lean();

    // Older routes do not have the new Point anchor yet. Keep them discoverable
    // during the gradual backfill instead of silently dropping them from Explore.
    if (routes.length < 20) {
        const legacyRoutes = await Route.find({ centroid: { $exists: false } }).limit(100).lean();
        const origin = { lat: latitude, lng: longitude };
        const nearbyLegacy = legacyRoutes
            .map((route) => ({ route, anchor: _legacyRouteAnchor(route) }))
            .filter(({ anchor }) => anchor && _metersBetween(origin, anchor) <= maxDistance)
            .sort((left, right) => _metersBetween(origin, left.anchor) - _metersBetween(origin, right.anchor))
            .slice(0, 20 - routes.length)
            .map(({ route }) => route);
        routes.push(...nearbyLegacy);
    }
    res.status(200).json({ status: 'success', data: { routes } });
});

// @desc    Get active Ride Buddy beacons within radius
// @route   GET /api/beacons/active
// @access  Public
export const getActiveBeacons = catchAsync(async (req, res) => {
    const { lat, lng, radius = 50000 } = req.query; // 50km

    let query = { status: 'ACTIVE' };

    if (lat && lng) {
        query.location = {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: [parseFloat(lng), parseFloat(lat)]
                },
                $maxDistance: parseInt(radius)
            }
        };
    }

    const beacons = await RideBeacon.find(query)
        .populate('author', 'name username avatar rank represents')
        .lean();

    res.status(200).json({ status: 'success', data: { beacons } });
});

// @desc    Create Ride Buddy beacon
// @route   POST /api/beacons
// @access  Private
export const createBeacon = catchAsync(async (req, res) => {
    const { lat, lng, meetupTime, pace, message } = req.body;
    const author = req.user._id;

    if (!lat || !lng || !meetupTime) {
        return res.status(400).json({ status: 'error', message: 'Konum (lat, lng) ve buluşma saati zorunludur.' });
    }

    // Cancel any other ACTIVE beacons by the same author to prevent spam
    await RideBeacon.updateMany({ author, status: 'ACTIVE' }, { status: 'CANCELED' });

    const beacon = await RideBeacon.create({
        author,
        location: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
        },
        meetupTime: new Date(meetupTime),
        pace: pace || 'CHILL',
        status: 'ACTIVE',
        message: message ? message.slice(0, 100) : ''
    });

    await beacon.populate('author', 'name username avatar rank represents');

    res.status(201).json({ status: 'success', data: { beacon } });
});

// @desc    Update beacon status (CANCELLED / COMPLETED) or details
// @route   PATCH /api/beacons/:id
// @access  Private
export const updateBeaconStatus = catchAsync(async (req, res) => {
    const { status, message, meetupTime, pace } = req.body;
    const beacon = await RideBeacon.findById(req.params.id);

    if (!beacon) {
        return res.status(404).json({ status: 'error', message: 'Beacon bulunamadı.' });
    }

    const requesterId = req.user._id.toString();
    if (beacon.author.toString() !== requesterId && !req.user.isAdmin) {
        return res.status(403).json({ status: 'error', message: 'Bu işlem için yetkiniz yok.' });
    }

    if (status) beacon.status = status;
    if (message !== undefined) beacon.message = message.slice(0, 100);
    if (meetupTime) beacon.meetupTime = new Date(meetupTime);
    if (pace) beacon.pace = pace;

    await beacon.save();
    await beacon.populate('author', 'name username avatar rank represents');

    res.status(200).json({ status: 'success', data: { beacon } });
});

// @desc    Delete beacon
// @route   DELETE /api/beacons/:id
// @access  Private
export const deleteBeacon = catchAsync(async (req, res) => {
    const beacon = await RideBeacon.findById(req.params.id);

    if (!beacon) {
        return res.status(404).json({ status: 'error', message: 'Beacon bulunamadı.' });
    }

    const requesterId = req.user._id.toString();
    if (beacon.author.toString() !== requesterId && !req.user.isAdmin) {
        return res.status(403).json({ status: 'error', message: 'Bu işlem için yetkiniz yok.' });
    }

    await RideBeacon.findByIdAndDelete(req.params.id);

    res.status(200).json({ status: 'success', message: 'Beacon başarıyla silindi.' });
});
