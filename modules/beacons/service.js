import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';

import { raiseHttpError } from '../../utils/httpError.js';

import Route from "../routes/model.js";
import User from "../users/model.js";
import RideBeacon from "../beacons/model.js";


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
export const exploreMapRoutes = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { lat, lng, radius = 50000 } = input.query; // Default 50km
    const latitude = Number(lat);
    const longitude = Number(lng);
    const maxDistance = Math.min(Math.max(Number(radius) || 50000, 1000), 200000);
    const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude) &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

    if (!hasLocation) {
        const routes = await Route.find({}).limit(20).lean();
        return respond({ status: 'success', data: { routes } },200);
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
    respond({ status: 'success', data: { routes } },200);

    return response;
};

// @desc    Get active Ride Buddy beacons within radius
// @route   GET /api/beacons/active
// @access  Public
export const getActiveBeacons = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { lat, lng, radius = 50000 } = input.query; // 50km

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

    respond({ status: 'success', data: { beacons } },200);

    return response;
};

// @desc    Create Ride Buddy beacon
// @route   POST /api/beacons
// @access  Private
export const createBeacon = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { lat, lng, meetupTime, pace, message } = input.body;
    const author = input.user._id;

    if (!lat || !lng || !meetupTime) {
        return raiseHttpError({ status: 'error', message: 'Konum (lat, lng) ve buluşma saati zorunludur.' },400);
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

    respond({ status: 'success', data: { beacon } },201);

    return response;
};

// @desc    Update beacon status (CANCELLED / COMPLETED) or details
// @route   PATCH /api/beacons/:id
// @access  Private
export const updateBeaconStatus = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { status, message, meetupTime, pace } = input.body;
    const beacon = await RideBeacon.findById(input.params.id);

    if (!beacon) {
        return raiseHttpError({ status: 'error', message: 'Beacon bulunamadı.' },404);
    }

    const requesterId = input.user._id.toString();
    if (beacon.author.toString() !== requesterId && !input.user.isAdmin) {
        return raiseHttpError({ status: 'error', message: 'Bu işlem için yetkiniz yok.' },403);
    }

    if (status) beacon.status = status;
    if (message !== undefined) beacon.message = message.slice(0, 100);
    if (meetupTime) beacon.meetupTime = new Date(meetupTime);
    if (pace) beacon.pace = pace;

    await beacon.save();
    await beacon.populate('author', 'name username avatar rank represents');

    respond({ status: 'success', data: { beacon } },200);

    return response;
};

// @desc    Delete beacon
// @route   DELETE /api/beacons/:id
// @access  Private
export const deleteBeacon = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const beacon = await RideBeacon.findById(input.params.id);

    if (!beacon) {
        return raiseHttpError({ status: 'error', message: 'Beacon bulunamadı.' },404);
    }

    const requesterId = input.user._id.toString();
    if (beacon.author.toString() !== requesterId && !input.user.isAdmin) {
        return raiseHttpError({ status: 'error', message: 'Bu işlem için yetkiniz yok.' },403);
    }

    await RideBeacon.findByIdAndDelete(input.params.id);

    respond({ status: 'success', message: 'Beacon başarıyla silindi.' },200);

    return response;
};
