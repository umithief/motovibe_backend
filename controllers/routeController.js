import Route from '../models/Route.js';
import User from '../models/User.js';
import catchAsync from '../utils/catchAsync.js';
import { generateApexRoutePreview } from '../services/apexRoutePlanner.js';
import { createNotification } from './notificationController.js';


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

const getRoutes = catchAsync(async (req, res) => {
    const { difficulty, q, tag, sort } = req.query;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    let query = {};
    if (difficulty) query.difficulty = _normalizeDifficulty(difficulty);
    if (tag) query.tags = new RegExp(`^${_escapeRegExp(tag)}$`, 'i');
    if (q) {
        const search = new RegExp(_escapeRegExp(q.trim()), 'i');
        query = { ...query, $or: [{ title: search }, { description: search }] };
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
    if (req.user) {
        const userData = await User.findById(req.user.id).select('savedRoutes').lean();
        const savedRouteIds = userData?.savedRoutes ? userData.savedRoutes.map(id => id.toString()) : [];

        routesWithStatus = routes.map(route => ({
            ...route,
            isSaved: savedRouteIds.includes(route._id.toString()),
            isMine: route.author && (
                route.author._id
                    ? route.author._id.toString() === req.user.id.toString()
                    : route.author.toString() === req.user.id.toString()
            )
        }));
    }

    res.status(200).json({
        success: true,
        status: 'success',
        data: { routes: routesWithStatus, page, hasMore }
    });
});

// @desc    Get routes created/saved by current user
// @route   GET /api/routes/my
// @access  Private
const getMyRoutes = catchAsync(async (req, res) => {
    const requesterId = req.user?._id || req.user?.id;

    if (!requesterId) {
        return res.status(401).json({ message: 'Authentication required.' });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const userData = await User.findById(requesterId).select('savedRoutes').lean();
    const savedRouteIds = userData?.savedRoutes
        ? userData.savedRoutes.map((id) => id.toString())
        : [];

    const scope = (req.query.scope || '').toString().trim().toLowerCase();
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
    if (req.query.difficulty) {
        filters.difficulty = _normalizeDifficulty(req.query.difficulty);
    }
    if (req.query.tag) {
        filters.tags = new RegExp(`^${_escapeRegExp(req.query.tag)}$`, 'i');
    }
    if (req.query.q?.trim()) {
        const search = new RegExp(_escapeRegExp(req.query.q.trim()), 'i');
        filters.$or = [{ title: search }, { description: search }];
    }
    const query = Object.keys(filters).length > 0
        ? { $and: [ownershipQuery, filters] }
        : ownershipQuery;

    const sortCriteria = _getSortCriteria(req.query.sort);
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

    res.status(200).json({
        success: true,
        status: 'success',
        data: { routes: routesWithStatus, page, hasMore }
    });
});

// @desc    Get route by ID
// @route   GET /api/routes/:id
// @access  Public
const getRouteById = catchAsync(async (req, res) => {
    const route = await Route.findById(req.params.id)
        .populate('author', 'name username avatar rank')
        .populate('reviews.user', 'name username avatar rank')
        .lean();
    if (route) {
        let isSaved = false;
        let isMine = false;
        if (req.user?.id) {
            const user = await User.findById(req.user.id).select('savedRoutes').lean();
            isSaved = user?.savedRoutes?.some((id) => id.toString() === route._id.toString()) ?? false;
            isMine = route.author && (
                route.author._id
                    ? route.author._id.toString() === req.user.id.toString()
                    : route.author.toString() === req.user.id.toString()
            );
        }
        res.status(200).json({ success: true, status: 'success', data: { route: { ...route, isSaved, isMine } } });
    } else {
        res.status(404);
        throw new Error('Route not found');
    }
});

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

const _escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Create a route
// @route   POST /api/routes
// @access  Private/PRO
const createRoute = catchAsync(async (req, res) => {
    if (!req.user?.isApex && !req.user?.isAdmin) {
        return res.status(403).json({
            status: 'fail',
            message: 'Kendi rotanı çizmek için MotoVibe PRO üyeliği gerekir.'
        });
    }

    const title = (req.body.title ?? '').toString().trim();
    if (!title) {
        return res.status(400).json({
            status: 'fail',
            message: 'Rota başlığı zorunludur.'
        });
    }

    const bodyCoordinates = _normalizeRouteCoordinates(req.body.coordinates);
    const pathCoordinates = _normalizeRouteCoordinates(req.body.path?.coordinates);
    const coordinates = _dedupeAdjacentCoordinates(
        bodyCoordinates.length > 0 ? bodyCoordinates : pathCoordinates
    );

    if (coordinates.length < 2) {
        return res.status(400).json({
            status: 'fail',
            message: 'Rota çizmek için haritada en az iki nokta seçmelisiniz.'
        });
    }

    if (coordinates.length > 200) {
        return res.status(400).json({
            status: 'fail',
            message: 'Maksimum 200 nokta eklenebilir.'
        });
    }

    const normalizedWaypoints = _normalizeStringList(req.body.waypoints);
    const normalizedPhotos = _normalizeStringList(req.body.photos);
    const normalizedTags = _normalizeStringList(req.body.tags);

    const difficulty = _normalizeDifficulty(req.body.difficulty);
    const distanceMeters = Number(req.body.distanceMeters) || undefined;
    const durationSeconds = Number(req.body.durationSeconds) || undefined;
    const stats = req.body.stats && typeof req.body.stats === 'object' ? req.body.stats : undefined;
    const difficultyMetrics = req.body.difficultyMetrics && typeof req.body.difficultyMetrics === 'object'
        ? req.body.difficultyMetrics
        : undefined;
    const terrain = Array.isArray(req.body.terrain)
        ? _normalizeStringList(req.body.terrain)
        : ['Asfalt'];

    const route = new Route({
        title,
        description: (req.body.description ?? '').toString().trim(),
        author: req.user._id,
        coordinates,
        path: {
            type: 'LineString',
            coordinates: coordinates.map((point) => [point.lng, point.lat])
        },
        centroid: _routeCentroid(coordinates),
        distance: (req.body.distance ?? '').toString().trim(),
        distanceMeters,
        durationSeconds,
        difficulty,
        estimatedTime: (req.body.estimatedTime ?? '').toString().trim(),
        location: (req.body.location ?? '').toString().trim(),
        image: (req.body.image ?? req.body.imageUrl ?? '').toString().trim(),
        waypoints: normalizedWaypoints,
        photos: normalizedPhotos,
        pois: _normalizePois(req.body.pois),
        tags: [...new Set(['PRO', 'Çizilmiş Rota', ...normalizedTags])],
        rating: Number(req.body.rating) || 0,
        riderCount: 0,
        terrain,
        ...(stats ? { stats } : {}),
        ...(difficultyMetrics ? { difficultyMetrics } : {})
    });

    const createdRoute = await route.save();
    res.status(201).json({
        success: true,
        status: 'success',
        data: { route: createdRoute }
    });
});

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

const updateRouteDetails = catchAsync(async (req, res, next) => {
    const route = await Route.findById(req.params.id);

    if (!route) {
        return next(new Error('Rota bulunamadı.'));
    }

    const requesterId = req.user?._id?.toString() || req.user?.id?.toString();
    const isOwner = !route.author || (
        requesterId && route.author.toString() === requesterId
    );

    if (!isOwner && !req.user?.isAdmin) {
        return res.status(403).json({
            status: 'fail',
            message: 'Bu rotayı güncelleme yetkiniz yok.'
        });
    }

    const payload = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
        payload.description = (req.body.description ?? '').toString().trim();
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'waypoints')) {
        payload.waypoints = _normalizeStringList(req.body.waypoints);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'photos')) {
        payload.photos = _normalizeStringList(req.body.photos);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'pois')) {
        payload.pois = _normalizePois(req.body.pois);
    }

    if (Object.keys(payload).length === 0) {
        return res.status(400).json({
            status: 'fail',
            message: 'Güncellenecek geçerli alan bulunamadı.'
        });
    }

    const updatedRoute = await Route.findByIdAndUpdate(
        req.params.id,
        { $set: payload },
        { new: true, runValidators: true }
    )
        .populate('author', 'name avatar')
        .populate('reviews.user', 'name avatar');

    res.status(200).json({
        status: 'success',
        data: updatedRoute
    });
});
const seedRoutes = catchAsync(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ status: 'fail', message: 'Seed endpoint is disabled in production.' });
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
    res.json(createdRoutes);
});

const generateApexRoute = catchAsync(async (req, res) => {
    if (!req.user?.isApex && !req.user?.isAdmin) {
        return res.status(403).json({ status: 'fail', message: 'Bu ozellik sadece Apex (PRO) kullanicilari icindir.' });
    }
    const routePreview = await generateApexRoutePreview(req.body);
    res.status(200).json({
        success: true,
        status: 'success',
        data: routePreview
    });
});

const saveRoute = catchAsync(async (req, res, next) => {
    const route = await Route.findById(req.params.id);
    if (!route) return next(new Error('Rota bulunamadi.'));
    const userData = await User.findById(req.user.id).select('savedRoutes').lean();
    const isSaved = userData?.savedRoutes && userData.savedRoutes.some(r => r.toString() === req.params.id);
    if (isSaved) {
        await User.findByIdAndUpdate(req.user.id, { $pull: { savedRoutes: route._id } });
        return res.json({ success: true, status: 'success', data: { isSaved: false } });
    } else {
        await User.findByIdAndUpdate(req.user.id, { $addToSet: { savedRoutes: route._id } });

        // Trigger ROUTE_SAVED Notification & Heads-up Push
        if (route.author && route.author.toString() !== req.user.id.toString()) {
            createNotification({
                recipient: route.author,
                sender: req.user.id,
                type: 'ROUTE_SAVED',
                route: route._id,
                routeId: route._id.toString(),
            }).catch((err) => console.warn('[Route] Notification save error:', err.message));
        }

        return res.json({ success: true, status: 'success', data: { isSaved: true } });
    }
});

const addReview = catchAsync(async (req, res, next) => {
    const rating = Number(req.body.rating);
    const comment = (req.body.comment ?? '').toString().trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 1000) {
        return res.status(400).json({ status: 'fail', message: 'Geçerli bir puan ve en fazla 1000 karakterlik yorum gönderin.' });
    }
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ status: 'fail', message: 'Rota bulunamadi.' });
    const existingReview = route.reviews.find((review) => review.user.toString() === req.user.id);
    if (existingReview) {
        existingReview.rating = rating;
        existingReview.comment = comment;
    } else {
        route.reviews.push({ user: req.user.id, rating, comment });
    }
    route.rating = route.reviews.reduce((acc, r) => acc + r.rating, 0) / route.reviews.length;
    await route.save();
    await route.populate('reviews.user', 'name username avatar rank');
    const review = existingReview ?? route.reviews[route.reviews.length - 1];

    // Trigger ROUTE_REVIEW Notification & Heads-up Push
    if (route.author && route.author.toString() !== req.user.id.toString()) {
        createNotification({
            recipient: route.author,
            sender: req.user.id,
            type: 'ROUTE_REVIEW',
            route: route._id,
            routeId: route._id.toString(),
            text: comment
        }).catch((err) => console.warn('[Route] Notification review error:', err.message));
    }

    res.status(existingReview ? 200 : 201).json({ success: true, status: 'success', data: review });
});

const editReview = catchAsync(async (req, res, next) => {
    const { rating, comment } = req.body;
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ status: 'fail', message: 'Rota bulunamadi.' });
    const review = route.reviews.id(req.params.reviewId);
    if (!review || review.user.toString() !== req.user.id) return res.status(403).json({ status: 'fail', message: 'Yetkisiz' });
    if (rating) review.rating = Number(rating);
    if (comment) review.comment = comment;
    route.rating = route.reviews.reduce((acc, r) => acc + r.rating, 0) / route.reviews.length;
    await route.save();
    await route.populate('reviews.user', 'name username avatar rank');
    res.json({ success: true, status: 'success', data: review });
});

const deleteReview = catchAsync(async (req, res, next) => {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ status: 'fail', message: 'Rota bulunamadi.' });
    const updateQuery = { $pull: { reviews: { _id: req.params.reviewId } } };
    if (route.path && (!route.path.coordinates || route.path.coordinates.length === 0)) updateQuery.$unset = { path: 1 };
    const updatedRoute = await Route.findOneAndUpdate({ _id: req.params.id }, updateQuery, { new: true, runValidators: false });
    const avgRating = updatedRoute.reviews.length > 0 ? updatedRoute.reviews.reduce((acc, r) => acc + r.rating, 0) / updatedRoute.reviews.length : 0;
    await Route.updateOne({ _id: req.params.id }, { $set: { rating: avgRating } });
    res.json({ success: true, status: 'success', message: 'Yorum silindi.' });
});

// @desc    Delete a route
// @route   DELETE /api/routes/:id
// @access  Private
const deleteRoute = catchAsync(async (req, res, next) => {
    const route = await Route.findById(req.params.id);
    if (!route) {
        return res.status(404).json({ status: 'fail', message: 'Rota bulunamadı.' });
    }

    const requesterId = req.user?._id?.toString() || req.user?.id?.toString();
    const isOwner = route.author && (
        route.author._id
            ? route.author._id.toString() === requesterId
            : route.author.toString() === requesterId
    );
    const isAdmin = Boolean(req.user?.isAdmin);

    if (!isOwner && !isAdmin) {
        return res.status(403).json({
            status: 'fail',
            message: 'Bu rotayı silme yetkiniz yok.'
        });
    }

    // Clean up savedRoutes references across users
    await User.updateMany(
        { savedRoutes: route._id },
        { $pull: { savedRoutes: route._id } }
    );

    await Route.findByIdAndDelete(req.params.id);

    res.status(200).json({
        success: true,
        status: 'success',
        message: 'Rota başarıyla silindi.'
    });
});

// @desc    Record a ride on a route (increment rider count)
// @route   POST /api/routes/:id/ride
// @access  Private
const recordRouteRide = catchAsync(async (req, res, next) => {
    const route = await Route.findById(req.params.id);
    if (!route) {
        return res.status(404).json({ status: 'fail', message: 'Rota bulunamadı.' });
    }

    const updated = await Route.findByIdAndUpdate(
        req.params.id,
        { $inc: { riderCount: 1 } },
        { new: true, runValidators: false }
    ).select('riderCount title');

    res.status(200).json({
        success: true,
        status: 'success',
        data: {
            riderCount: updated.riderCount,
            message: 'Sürüş başarıyla kaydedildi.'
        }
    });
});

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
