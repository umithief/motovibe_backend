import AppError from '../../utils/appError.js';
import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';

import { raiseHttpError } from '../../utils/httpError.js';

import Route from "./model.js";
import User from "../users/model.js";

import { generateApexRoutePreview } from "./service.js";
import { createNotification } from "../notifications/service.js";
import { notifyTextMentions } from "../notifications/mention.service.js";


// @desc    Get all routes
// @route   GET /api/routes
// @access  Public
// @desc    Get all routes
// @route   GET /api/routes
// @access  Public
const _getSortCriteria = (sortKey) => {
    switch ((sortKey || '').toString().trim().toLowerCase()) {
        case 'popular':
            return { riderCount: -1, createdAt: -1 };
        case 'top_rated':
            return { rating: -1, createdAt: -1 };
        case 'distance_asc':
            return { distance: 1, createdAt: -1 };
        case 'distance_desc':
            return { distance: -1, createdAt: -1 };
        case 'newest':
        default:
            return { createdAt: -1 };
    }
};

const getRoutes = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { difficulty, q, tag, sort } = input.query;

    const page = Math.max(parseInt(input.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(input.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    let query = {};
    if (difficulty) query.difficulty = _normalizeDifficulty(difficulty);
    if (tag) query.tags = new RegExp(`^${_escapeRegExp(tag)}$`, 'i');
    if (q) {
        const search = new RegExp(_escapeRegExp(q.trim()), 'i');
        query = {
            ...query,
            $or: [
                { title: search },
                { description: search },
                { location: search },
                { waypoints: search },
                { tags: search }
            ]
        };
    }
    const sortCriteria = _getSortCriteria(sort);
    const routes = await Route.find(query)
        .populate('author', 'name username avatar rank')
        .sort(sortCriteria)
        .skip(skip)
        .limit(limit)
        .lean();

    const totalRoutes = await Route.countDocuments(query);
    const hasMore = skip + routes.length < totalRoutes;

    let routesWithStatus = routes;
    if (input.user) {
        const userData = await User.findById(input.user.id).select('savedRoutes').lean();
        const savedRouteIds = userData?.savedRoutes ? userData.savedRoutes.map(id => id.toString()) : [];

        routesWithStatus = routes.map(route => ({
            ...route,
            isSaved: savedRouteIds.includes(route._id.toString()),
            isMine: route.author && (
                route.author._id
                    ? route.author._id.toString() === input.user.id.toString()
                    : route.author.toString() === input.user.id.toString()
            )
        }));
    }

    respond({
        success: true,
        status: 'success',
        data: { routes: routesWithStatus, page, hasMore }
    },200);

    return response;
};

// @desc    Get routes created/saved by current user
// @route   GET /api/routes/my
// @access  Private
const getMyRoutes = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const requesterId = input.user?._id || input.user?.id;

    if (!requesterId) {
        return raiseHttpError({ message: 'Authentication required.' },401);
    }

    const page = Math.max(parseInt(input.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(input.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const userData = await User.findById(requesterId).select('savedRoutes').lean();
    const savedRouteIds = userData?.savedRoutes
        ? userData.savedRoutes.map((id) => id.toString())
        : [];

    const scope = (input.query.scope || '').toString().trim().toLowerCase();
    let ownershipQuery;
    if (scope === 'created') {
        ownershipQuery = { author: requesterId };
    } else if (scope === 'saved') {
        ownershipQuery = { _id: { $in: savedRouteIds } };
    } else {
        ownershipQuery = savedRouteIds.length > 0
            ? {
                $or: [
                    { author: requesterId },
                    { _id: { $in: savedRouteIds } },
                ],
            }
            : { author: requesterId };
    }

    const filters = {};
    if (input.query.difficulty) {
        filters.difficulty = _normalizeDifficulty(input.query.difficulty);
    }
    if (input.query.tag) {
        filters.tags = new RegExp(`^${_escapeRegExp(input.query.tag)}$`, 'i');
    }
    if (input.query.q?.trim()) {
        const search = new RegExp(_escapeRegExp(input.query.q.trim()), 'i');
        filters.$or = [
            { title: search },
            { description: search },
            { location: search },
            { waypoints: search },
            { tags: search }
        ];
    }
    const query = Object.keys(filters).length > 0
        ? { $and: [ownershipQuery, filters] }
        : ownershipQuery;

    const sortCriteria = _getSortCriteria(input.query.sort);
    const myRoutes = await Route.find(query)
        .populate('author', 'name username avatar rank')
        .sort(sortCriteria)
        .skip(skip)
        .limit(limit)
        .lean();

    const totalRoutes = await Route.countDocuments(query);
    const hasMore = skip + myRoutes.length < totalRoutes;

    const routesWithStatus = myRoutes.map((route) => ({
        ...route,
        isSaved: savedRouteIds.includes(route._id.toString()),
        isMine:
            route.author &&
            (route.author._id
                ? route.author._id.toString() === requesterId.toString()
                : route.author.toString() === requesterId.toString()),
    }));

    respond({
        success: true,
        status: 'success',
        data: { routes: routesWithStatus, page, hasMore }
    },200);

    return response;
};

// @desc    Get route by ID
// @route   GET /api/routes/:id
// @access  Public
const getRouteById = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const route = await Route.findById(input.params.id)
        .populate('author', 'name username avatar rank')
        .populate('reviews.user', 'name username avatar rank')
        .lean();
    if (route) {
        let isSaved = false;
        let isMine = false;
        if (input.user?.id) {
            const user = await User.findById(input.user.id).select('savedRoutes').lean();
            isSaved = user?.savedRoutes?.some((id) => id.toString() === route._id.toString()) ?? false;
            isMine = route.author && (
                route.author._id
                    ? route.author._id.toString() === input.user.id.toString()
                    : route.author.toString() === input.user.id.toString()
            );
        }
        respond({ success: true, status: 'success', data: { route: { ...route, isSaved, isMine } } },200);
    } else {
        throw new AppError('Route not found',404);
    }

    return response;
};

const _normalizeRouteCoordinates = (rawValue) => {
    if (!Array.isArray(rawValue)) return [];

    const parsed = [];
    rawValue.forEach((item) => {
        let lat;
        let lng;

        if (Array.isArray(item) && item.length >= 2) {
            const first = Number(item[0]);
            const second = Number(item[1]);
            if (Number.isFinite(first) && Number.isFinite(second)) {
                // Frontend sends [lng, lat] for GeoJSON-style pairs.
                lng = first;
                lat = second;
            }
        } else if (item && typeof item === 'object') {
            lat = Number(item.lat ?? item.latitude);
            lng = Number(item.lng ?? item.lon ?? item.longitude);
        }

        if (
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180
        ) {
            parsed.push({ lat, lng });
        }
    });

    return parsed;
};

const _dedupeAdjacentCoordinates = (coordinates) => {
    const deduped = [];

    coordinates.forEach((point) => {
        const previous = deduped[deduped.length - 1];
        if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) {
            deduped.push(point);
        }
    });

    return deduped;
};

const _normalizeDifficulty = (rawValue) => {
    const value = (rawValue ?? '').toString().trim().toLowerCase();
    if (value === 'kolay') return 'Kolay';
    if (value === 'zor') return 'Zor';
    return 'Orta';
};

const _routeCentroid = (coordinates) => {
    if (!coordinates.length) return undefined;
    const latitude = coordinates.reduce((sum, point) => sum + point.lat, 0) / coordinates.length;
    const longitude = coordinates.reduce((sum, point) => sum + point.lng, 0) / coordinates.length;
    return { type: 'Point', coordinates: [longitude, latitude] };
};

const _toRad = (deg) => (deg * Math.PI) / 180;

const _haversineMeters = (a, b) => {
    const R = 6371000;
    const dLat = _toRad(b.lat - a.lat);
    const dLng = _toRad(b.lng - a.lng);
    const lat1 = _toRad(a.lat);
    const lat2 = _toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};

const _bearingDegrees = (a, b) => {
    const lat1 = _toRad(a.lat);
    const lat2 = _toRad(b.lat);
    const dLng = _toRad(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

const _computeRouteTelemetry = (coordinates, rawDistanceMeters, rawDurationSeconds, terrain = []) => {
    let computedMeters = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
        computedMeters += _haversineMeters(coordinates[i - 1], coordinates[i]);
    }

    const distanceMeters = Math.round(
        Number.isFinite(Number(rawDistanceMeters)) && Number(rawDistanceMeters) > 0
            ? Number(rawDistanceMeters)
            : computedMeters
    );

    let curves = 0;
    let prevBearing = null;
    for (let i = 1; i < coordinates.length; i += 1) {
        const segMeters = _haversineMeters(coordinates[i - 1], coordinates[i]);
        if (segMeters < 12) continue;
        const bearing = _bearingDegrees(coordinates[i - 1], coordinates[i]);
        if (prevBearing !== null) {
            let delta = Math.abs(bearing - prevBearing) % 360;
            if (delta > 180) delta = 360 - delta;
            if (delta >= 18) curves += 1;
        }
        prevBearing = bearing;
    }

    const km = Math.max(0.1, distanceMeters / 1000);
    const curveDensityPerKm = km > 0.2 ? curves / km : 0;
    const hasMountainOrDirt = terrain.some((t) => /dağ|stabilize|toprak/i.test(t));
    const isCoastal = terrain.some((t) => /sahil|kıyı/i.test(t));
    const isForest = terrain.some((t) => /orman/i.test(t));

    const avgSpeedKmh = hasMountainOrDirt
        ? 44
        : curveDensityPerKm > 2.2
            ? 48
            : curveDensityPerKm > 1.0
                ? 58
                : 68;
    const durationSeconds = Math.round(
        Number.isFinite(Number(rawDurationSeconds)) && Number(rawDurationSeconds) > 0
            ? Number(rawDurationSeconds)
            : Math.max(60, (km / avgSpeedKmh) * 3600)
    );

    const distanceLabel = km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
    const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const remMinutes = totalMinutes % 60;
    const estimatedTime = hours === 0
        ? `${totalMinutes} dk`
        : remMinutes === 0
            ? `${hours} sa`
            : `${hours} sa ${remMinutes} dk`;

    const technicalRaw = Math.min(98, Math.max(15, Math.round(28 + curveDensityPerKm * 18 + (hasMountainOrDirt ? 18 : 0) + (km > 80 ? 10 : 0))));
    const sceneryRaw = Math.min(99, Math.max(45, Math.round(68 + (isCoastal ? 18 : 0) + (isForest || hasMountainOrDirt ? 14 : 0) + curveDensityPerKm * 4)));
    const speedRaw = Math.min(95, Math.max(25, Math.round(88 - curveDensityPerKm * 12 - (hasMountainOrDirt ? 20 : 0))));

    return {
        distanceMeters,
        durationSeconds,
        distance: distanceLabel,
        estimatedTime,
        stats: {
            curves,
            roadQuality: hasMountainOrDirt ? 72 : isForest ? 84 : 92,
            traffic: isForest || hasMountainOrDirt ? 18 : isCoastal ? 38 : 30
        },
        difficultyMetrics: {
            technical: Math.min(5, Math.max(1, Math.round(technicalRaw / 20))),
            scenery: Math.min(5, Math.max(1, Math.round(sceneryRaw / 20))),
            speed: Math.min(5, Math.max(1, Math.round(speedRaw / 20)))
        }
    };
};

const _normalizeStats = (rawStats, fallbackStats) => {
    const base = fallbackStats || { curves: 0, roadQuality: 85, traffic: 25 };
    if (!rawStats || typeof rawStats !== 'object') return base;
    const curves = Number(rawStats.curves);
    const roadQuality = Number(rawStats.roadQuality);
    const traffic = Number(rawStats.traffic);
    return {
        curves: Number.isFinite(curves) && curves >= 0 ? Math.round(curves) : base.curves,
        roadQuality: Number.isFinite(roadQuality) && roadQuality >= 0 ? Math.min(100, Math.round(roadQuality)) : base.roadQuality,
        traffic: Number.isFinite(traffic) && traffic >= 0 ? Math.min(100, Math.round(traffic)) : base.traffic
    };
};

const _normalizeDifficultyMetrics = (rawMetrics, fallbackMetrics) => {
    const base = fallbackMetrics || { technical: 3, scenery: 4, speed: 3 };
    if (!rawMetrics || typeof rawMetrics !== 'object') return base;
    const clamp1to5 = (val, fallback) => {
        const num = Number(val);
        if (!Number.isFinite(num) || num <= 0) return fallback;
        // Support both 1-5 and 1-100 scales gracefully
        const scaled = num > 5 ? Math.round(num / 20) : Math.round(num);
        return Math.min(5, Math.max(1, scaled));
    };
    return {
        technical: clamp1to5(rawMetrics.technical, base.technical),
        scenery: clamp1to5(rawMetrics.scenery, base.scenery),
        speed: clamp1to5(rawMetrics.speed, base.speed)
    };
};

const _escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Create a route
// @route   POST /api/routes
// @access  Private/PRO
const createRoute = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    if (!input.user?.isApex && !input.user?.isAdmin) {
        return raiseHttpError({
            status: 'fail',
            message: 'Kendi rotanı çizmek için MotoVibe PRO üyeliği gerekir.'
        },403);
    }

    const title = (input.body.title ?? '').toString().trim();
    if (!title) {
        return raiseHttpError({
            status: 'fail',
            message: 'Rota başlığı zorunludur.'
        },400);
    }

    const bodyCoordinates = _normalizeRouteCoordinates(input.body.coordinates);
    const pathCoordinates = _normalizeRouteCoordinates(input.body.path?.coordinates);
    const coordinates = _dedupeAdjacentCoordinates(
        bodyCoordinates.length > 0 ? bodyCoordinates : pathCoordinates
    );

    if (coordinates.length < 2) {
        return raiseHttpError({
            status: 'fail',
            message: 'Rota çizmek için haritada en az iki nokta seçmelisiniz.'
        },400);
    }

    if (coordinates.length > 2000) {
        return raiseHttpError({
            status: 'fail',
            message: 'Maksimum 2000 nokta eklenebilir.'
        },400);
    }

    const normalizedWaypoints = _normalizeStringList(input.body.waypoints);
    const normalizedPhotos = _normalizeStringList(input.body.photos);
    const normalizedTags = _normalizeStringList(input.body.tags);
    const terrain = Array.isArray(input.body.terrain) && input.body.terrain.length > 0
        ? _normalizeStringList(input.body.terrain)
        : ['Asfalt'];

    const telemetry = _computeRouteTelemetry(
        coordinates,
        input.body.distanceMeters,
        input.body.durationSeconds,
        terrain
    );

    const difficulty = _normalizeDifficulty(input.body.difficulty);
    const distanceMeters = telemetry.distanceMeters;
    const durationSeconds = telemetry.durationSeconds;
    const stats = _normalizeStats(input.body.stats, telemetry.stats);
    const difficultyMetrics = _normalizeDifficultyMetrics(
        input.body.difficultyMetrics,
        telemetry.difficultyMetrics
    );
    const isAIGenerated = Boolean(input.body.isAIGenerated);
    const bestSeason = (input.body.bestSeason ?? 'İlkbahar - Sonbahar').toString().trim();
    const fallbackLocation = normalizedWaypoints.length >= 2
        ? `${normalizedWaypoints[0]} → ${normalizedWaypoints[normalizedWaypoints.length - 1]}`
        : normalizedWaypoints[0] || '';
    const location = (input.body.location ?? fallbackLocation).toString().trim();

    const route = new Route({
        title,
        description: (input.body.description ?? '').toString().trim(),
        author: input.user._id,
        coordinates,
        path: {
            type: 'LineString',
            coordinates: coordinates.map((point) => [point.lng, point.lat])
        },
        centroid: _routeCentroid(coordinates),
        distance: (input.body.distance ?? telemetry.distance).toString().trim() || telemetry.distance,
        distanceMeters,
        durationSeconds,
        difficulty,
        estimatedTime: (input.body.estimatedTime ?? telemetry.estimatedTime).toString().trim() || telemetry.estimatedTime,
        location,
        bestSeason,
        isAIGenerated,
        image: (input.body.image ?? input.body.imageUrl ?? '').toString().trim(),
        waypoints: normalizedWaypoints,
        photos: normalizedPhotos,
        pois: _normalizePois(input.body.pois),
        tags: [...new Set(['PRO', 'Çizilmiş Rota', ...(isAIGenerated ? ['AI Generated'] : []), ...terrain, ...normalizedTags])],
        rating: Number(input.body.rating) || 0,
        riderCount: 0,
        terrain,
        stats,
        difficultyMetrics
    });

    const createdRoute = await route.save();
    respond({
        success: true,
        status: 'success',
        data: { route: createdRoute }
    },201);

    return response;
};

const _normalizeStringList = (rawValue) => {
    if (!Array.isArray(rawValue)) return [];

    return [...new Set(
        rawValue
            .map((item) => (item ?? '').toString().trim())
            .filter(Boolean)
    )];
};

const _normalizePois = (rawValue) => {
    if (!Array.isArray(rawValue)) return [];

    const allowedTypes = new Set([
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
    ]);

    return rawValue
        .map((rawPoi) => {
            if (!rawPoi || typeof rawPoi !== 'object') return null;

            const type = (rawPoi.type ?? '').toString().trim().toUpperCase();
            if (!allowedTypes.has(type)) return null;

            const note = (rawPoi.note ?? '').toString().trim();
            const latRaw = rawPoi.lat ?? rawPoi.latitude;
            const lngRaw = rawPoi.lng ?? rawPoi.longitude;
            const lat = Number(latRaw);
            const lng = Number(lngRaw);

            const normalizedPoi = { type };
            if (note) normalizedPoi.note = note;

            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    normalizedPoi.location = {
                        type: 'Point',
                        coordinates: [lng, lat]
                    };
                }
            } else if (
                rawPoi.location &&
                Array.isArray(rawPoi.location.coordinates) &&
                rawPoi.location.coordinates.length >= 2
            ) {
                const locationLng = Number(rawPoi.location.coordinates[0]);
                const locationLat = Number(rawPoi.location.coordinates[1]);
                if (
                    Number.isFinite(locationLat) &&
                    Number.isFinite(locationLng) &&
                    locationLat >= -90 &&
                    locationLat <= 90 &&
                    locationLng >= -180 &&
                    locationLng <= 180
                ) {
                    normalizedPoi.location = {
                        type: 'Point',
                        coordinates: [locationLng, locationLat]
                    };
                }
            }

            return normalizedPoi;
        })
        .filter(Boolean);
};

const updateRouteDetails = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const route = await Route.findById(input.params.id);

    if (!route) {
        return throwError(new Error('Rota bulunamadı.'));
    }

    const requesterId = input.user?._id?.toString() || input.user?.id?.toString();
    const isOwner = !route.author || (
        requesterId && route.author.toString() === requesterId
    );

    if (!isOwner && !input.user?.isAdmin) {
        return raiseHttpError({
            status: 'fail',
            message: 'Bu rotayı güncelleme yetkiniz yok.'
        },403);
    }

    const payload = {};

    if (Object.prototype.hasOwnProperty.call(input.body, 'title')) {
        const trimmedTitle = (input.body.title ?? '').toString().trim();
        if (trimmedTitle) payload.title = trimmedTitle;
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'description')) {
        payload.description = (input.body.description ?? '').toString().trim();
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'difficulty')) {
        payload.difficulty = _normalizeDifficulty(input.body.difficulty);
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'location')) {
        payload.location = (input.body.location ?? '').toString().trim();
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'bestSeason')) {
        payload.bestSeason = (input.body.bestSeason ?? '').toString().trim();
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'image') || Object.prototype.hasOwnProperty.call(input.body, 'imageUrl')) {
        payload.image = (input.body.image ?? input.body.imageUrl ?? '').toString().trim();
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'terrain')) {
        payload.terrain = _normalizeStringList(input.body.terrain);
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'tags')) {
        payload.tags = _normalizeStringList(input.body.tags);
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'waypoints')) {
        payload.waypoints = _normalizeStringList(input.body.waypoints);
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'photos')) {
        payload.photos = _normalizeStringList(input.body.photos);
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'pois')) {
        payload.pois = _normalizePois(input.body.pois);
    }

    if (Object.prototype.hasOwnProperty.call(input.body, 'coordinates') || Object.prototype.hasOwnProperty.call(input.body, 'path')) {
        const bodyCoordinates = _normalizeRouteCoordinates(input.body.coordinates);
        const pathCoordinates = _normalizeRouteCoordinates(input.body.path?.coordinates);
        const coordinates = _dedupeAdjacentCoordinates(
            bodyCoordinates.length > 0 ? bodyCoordinates : pathCoordinates
        );
        if (coordinates.length >= 2 && coordinates.length <= 2000) {
            const terrainForTelemetry = payload.terrain || route.terrain || ['Asfalt'];
            const telemetry = _computeRouteTelemetry(
                coordinates,
                input.body.distanceMeters,
                input.body.durationSeconds,
                terrainForTelemetry
            );
            payload.coordinates = coordinates;
            payload.path = {
                type: 'LineString',
                coordinates: coordinates.map((point) => [point.lng, point.lat])
            };
            payload.centroid = _routeCentroid(coordinates);
            payload.distanceMeters = telemetry.distanceMeters;
            payload.durationSeconds = telemetry.durationSeconds;
            payload.distance = (input.body.distance ?? telemetry.distance).toString().trim() || telemetry.distance;
            payload.estimatedTime = (input.body.estimatedTime ?? telemetry.estimatedTime).toString().trim() || telemetry.estimatedTime;
            payload.stats = _normalizeStats(input.body.stats, telemetry.stats);
            payload.difficultyMetrics = _normalizeDifficultyMetrics(
                input.body.difficultyMetrics,
                telemetry.difficultyMetrics
            );
        }
    } else {
        if (Object.prototype.hasOwnProperty.call(input.body, 'distance')) {
            payload.distance = (input.body.distance ?? '').toString().trim();
        }
        if (Object.prototype.hasOwnProperty.call(input.body, 'estimatedTime')) {
            payload.estimatedTime = (input.body.estimatedTime ?? '').toString().trim();
        }
        if (Object.prototype.hasOwnProperty.call(input.body, 'distanceMeters') && Number.isFinite(Number(input.body.distanceMeters))) {
            payload.distanceMeters = Math.round(Number(input.body.distanceMeters));
        }
        if (Object.prototype.hasOwnProperty.call(input.body, 'durationSeconds') && Number.isFinite(Number(input.body.durationSeconds))) {
            payload.durationSeconds = Math.round(Number(input.body.durationSeconds));
        }
        if (Object.prototype.hasOwnProperty.call(input.body, 'stats') && input.body.stats && typeof input.body.stats === 'object') {
            payload.stats = _normalizeStats(input.body.stats, route.stats);
        }
        if (Object.prototype.hasOwnProperty.call(input.body, 'difficultyMetrics') && input.body.difficultyMetrics && typeof input.body.difficultyMetrics === 'object') {
            payload.difficultyMetrics = _normalizeDifficultyMetrics(input.body.difficultyMetrics, route.difficultyMetrics);
        }
    }

    if (Object.keys(payload).length === 0) {
        return raiseHttpError({
            status: 'fail',
            message: 'Güncellenecek geçerli alan bulunamadı.'
        },400);
    }

    const updatedRoute = await Route.findByIdAndUpdate(
        input.params.id,
        { $set: payload },
        { new: true, runValidators: true }
    )
        .populate('author', 'name avatar')
        .populate('reviews.user', 'name avatar');

    respond({
        status: 'success',
        data: updatedRoute
    },200);

    return response;
};
const seedRoutes = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    if (process.env.NODE_ENV === 'production') {
        return raiseHttpError({ status: 'fail', message: 'Seed endpoint is disabled in production.' },403);
    }
    await Route.deleteMany({});
    const sampleRoutes = [{
        title: 'Sile Sahil Yolu',
        description: 'Mavi ve yesilin bulustugu bu sahil yolunda ruzgarla dans edin.',
        distance: '145 km',
        estimatedTime: '2h 15m',
        difficulty: 'Orta',
        location: 'Sile, Istanbul',
        image: 'http://localhost:' + (process.env.PORT || 5001) + '/uploads/route_coastal.png',
        stats: { curves: 75, roadQuality: 90, traffic: 40 },
        tags: ['Sahil', 'Manzara', 'Hizli', 'Virajli'],
        riderCount: 1243,
        bestSeason: 'Ilkbahar, Yaz',
        difficultyMetrics: { technical: 3, scenery: 5, speed: 4 },
        terrain: ['Asfalt'],
        coordinates: [{ lat: 41.0450, lng: 29.0300 }, { lat: 41.0470, lng: 29.0350 }],
        centroid: { type: 'Point', coordinates: [29.0325, 41.046] }
    }];
    const createdRoutes = await Route.insertMany(sampleRoutes);
    respond(createdRoutes,200);

    return response;
};

const generateApexRoute = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    if (!input.user?.isApex && !input.user?.isAdmin) {
        return raiseHttpError({ status: 'fail', message: 'Bu ozellik sadece Apex (PRO) kullanicilari icindir.' },403);
    }
    const routePreview = await generateApexRoutePreview(input.body);
    respond({
        success: true,
        status: 'success',
        data: routePreview
    },200);

    return response;
};

const saveRoute = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const route = await Route.findById(input.params.id);
    if (!route) return throwError(new Error('Rota bulunamadi.'));
    const userData = await User.findById(input.user.id).select('savedRoutes').lean();
    const isSaved = userData?.savedRoutes && userData.savedRoutes.some(r => r.toString() === input.params.id);
    if (isSaved) {
        await User.findByIdAndUpdate(input.user.id, { $pull: { savedRoutes: route._id } });
        return respond({ success: true, status: 'success', data: { isSaved: false } },200);
    } else {
        await User.findByIdAndUpdate(input.user.id, { $addToSet: { savedRoutes: route._id } });

        // Trigger ROUTE_SAVED Notification & Heads-up Push
        if (route.author && route.author.toString() !== input.user.id.toString()) {
            createNotification({
                recipient: route.author,
                sender: input.user.id,
                type: 'ROUTE_SAVED',
                route: route._id,
                routeId: route._id.toString(),
            }).catch((err) => console.warn('[Route] Notification save error:', err.message));
        }

        return respond({ success: true, status: 'success', data: { isSaved: true } },200);
    }

    return response;
};

const addReview = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const rating = Number(input.body.rating);
    const comment = (input.body.comment ?? '').toString().trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 1000) {
        return raiseHttpError({ status: 'fail', message: 'Geçerli bir puan ve en fazla 1000 karakterlik yorum gönderin.' },400);
    }
    const route = await Route.findById(input.params.id);
    if (!route) return raiseHttpError({ status: 'fail', message: 'Rota bulunamadi.' },404);
    const existingReview = route.reviews.find((review) => review.user.toString() === input.user.id);
    const previousComment = existingReview?.comment || '';
    if (existingReview) {
        existingReview.rating = rating;
        existingReview.comment = comment;
    } else {
        route.reviews.push({ user: input.user.id, rating, comment });
    }
    route.rating = route.reviews.reduce((acc, r) => acc + r.rating, 0) / route.reviews.length;
    await route.save();
    await route.populate('reviews.user', 'name username avatar rank');
    const review = existingReview ?? route.reviews[route.reviews.length - 1];

    // Trigger ROUTE_REVIEW Notification & Heads-up Push
    if (route.author && route.author.toString() !== input.user.id.toString()) {
        createNotification({
            recipient: route.author,
            sender: input.user.id,
            type: 'ROUTE_REVIEW',
            route: route._id,
            routeId: route._id.toString(),
            text: comment
        }).catch((err) => console.warn('[Route] Notification review error:', err.message));
    }

    notifyTextMentions({
        text: comment,
        previousText: previousComment,
        actorId: input.user.id,
        type: 'MENTIONED_IN_ROUTE_REVIEW',
        // Route author already receives ROUTE_REVIEW for this review.
        excludeUserIds: [route.author],
        refs: { route: route._id, routeId: route._id.toString() },
    });

    respond({ success: true, status: 'success', data: review },existingReview ? 200 : 201);

    return response;
};

const editReview = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { rating, comment } = input.body;
    const route = await Route.findById(input.params.id);
    if (!route) return raiseHttpError({ status: 'fail', message: 'Rota bulunamadi.' },404);
    const review = route.reviews.id(input.params.reviewId);
    if (!review || review.user.toString() !== input.user.id) return raiseHttpError({ status: 'fail', message: 'Yetkisiz' },403);
    const previousComment = review.comment || '';
    if (rating) review.rating = Number(rating);
    if (comment) review.comment = comment;
    route.rating = route.reviews.reduce((acc, r) => acc + r.rating, 0) / route.reviews.length;
    await route.save();
    if (comment) {
        notifyTextMentions({
            text: String(comment),
            previousText: previousComment,
            actorId: input.user.id,
            type: 'MENTIONED_IN_ROUTE_REVIEW',
            excludeUserIds: [route.author],
            refs: { route: route._id, routeId: route._id.toString() },
        });
    }
    await route.populate('reviews.user', 'name username avatar rank');
    respond({ success: true, status: 'success', data: review },200);

    return response;
};

const deleteReview = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const route = await Route.findById(input.params.id);
    if (!route) return raiseHttpError({ status: 'fail', message: 'Rota bulunamadi.' },404);
    const updateQuery = { $pull: { reviews: { _id: input.params.reviewId } } };
    if (route.path && (!route.path.coordinates || route.path.coordinates.length === 0)) updateQuery.$unset = { path: 1 };
    const updatedRoute = await Route.findOneAndUpdate({ _id: input.params.id }, updateQuery, { new: true, runValidators: false });
    const avgRating = updatedRoute.reviews.length > 0 ? updatedRoute.reviews.reduce((acc, r) => acc + r.rating, 0) / updatedRoute.reviews.length : 0;
    await Route.updateOne({ _id: input.params.id }, { $set: { rating: avgRating } });
    respond({ success: true, status: 'success', message: 'Yorum silindi.' },200);

    return response;
};

// @desc    Delete a route
// @route   DELETE /api/routes/:id
// @access  Private
const deleteRoute = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const route = await Route.findById(input.params.id);
    if (!route) {
        return raiseHttpError({ status: 'fail', message: 'Rota bulunamadı.' },404);
    }

    const requesterId = input.user?._id?.toString() || input.user?.id?.toString();
    const isOwner = route.author && (
        route.author._id
            ? route.author._id.toString() === requesterId
            : route.author.toString() === requesterId
    );
    const isAdmin = Boolean(input.user?.isAdmin);

    if (!isOwner && !isAdmin) {
        return raiseHttpError({
            status: 'fail',
            message: 'Bu rotayı silme yetkiniz yok.'
        },403);
    }

    // Clean up savedRoutes references across users
    await User.updateMany(
        { savedRoutes: route._id },
        { $pull: { savedRoutes: route._id } }
    );

    await Route.findByIdAndDelete(input.params.id);

    respond({
        success: true,
        status: 'success',
        message: 'Rota başarıyla silindi.'
    },200);

    return response;
};

// @desc    Record a ride on a route (increment rider count)
// @route   POST /api/routes/:id/ride
// @access  Private
const recordRouteRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const route = await Route.findById(input.params.id);
    if (!route) {
        return raiseHttpError({ status: 'fail', message: 'Rota bulunamadı.' },404);
    }

    const updated = await Route.findByIdAndUpdate(
        input.params.id,
        { $inc: { riderCount: 1 } },
        { new: true, runValidators: false }
    ).select('riderCount title');

    respond({
        success: true,
        status: 'success',
        data: {
            riderCount: updated.riderCount,
            message: 'Sürüş başarıyla kaydedildi.'
        }
    },200);

    return response;
};

export {
    getRoutes,
    getMyRoutes,
    getRouteById,
    createRoute,
    updateRouteDetails,
    deleteRoute,
    recordRouteRide,
    seedRoutes,
    generateApexRoute,
    saveRoute,
    addReview,
    editReview,
    deleteReview
};
