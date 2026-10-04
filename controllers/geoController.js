import GeoPoi from '../models/GeoPoi.js';
import RoadReport from '../models/RoadReport.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/appError.js';
import { geoConfig } from '../services/geo/geoConfig.js';
import { buildRouteIntelligence } from '../services/geo/routeIntelligenceService.js';
import { roadReportCategories, resolveRoadReportExpiry } from '../services/geo/roadReportPolicy.js';
import { getGeoProviderMetrics } from '../services/geo/geoProviderMonitor.js';
import { getGeoCacheMetrics } from '../services/geo/geoCache.js';

const parseCoordinate = (value, min, max, label) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new AppError(`Gecerli bir ${label} gereklidir.`, 400);
    return parsed;
};

const parseRadius = (value) => {
    const config = geoConfig();
    const radius = value === undefined ? 5000 : Number(value);
    if (!Number.isFinite(radius) || radius < 100 || radius > config.limits.nearbyRadiusMeters) {
        throw new AppError(`Yaricap 100-${config.limits.nearbyRadiusMeters} metre araliginda olmalidir.`, 400);
    }
    return radius;
};

const formatRoadReport = (report) => ({
    id: report._id.toString(),
    category: report.category,
    description: report.description || undefined,
    location: { lng: report.location.coordinates[0], lat: report.location.coordinates[1] },
    verificationScore: report.verificationScore,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt
});

export const getNearbyPois = catchAsync(async (req, res) => {
    const lat = parseCoordinate(req.query.lat, -90, 90, 'enlem');
    const lng = parseCoordinate(req.query.lng, -180, 180, 'boylam');
    const radius = parseRadius(req.query.radius);
    const config = geoConfig();
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Math.max(1, Math.min(config.limits.poiLimit, Number.isFinite(requestedLimit) ? requestedLimit : 50));
    const categories = typeof req.query.categories === 'string'
        ? req.query.categories.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    const query = {
        location: { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radius } },
        ...(categories.length ? { category: { $in: categories } } : {})
    };
    const pois = await GeoPoi.find(query).limit(limit).lean();
    res.status(200).json({
        status: 'success',
        data: pois.map((poi) => ({
            id: poi._id.toString(), source: poi.source, name: poi.name || undefined, category: poi.category,
            location: { lng: poi.location.coordinates[0], lat: poi.location.coordinates[1] },
            metadata: poi.metadata, attribution: poi.attribution
        }))
    });
});

export const getNearbyRoadReports = catchAsync(async (req, res) => {
    const lat = parseCoordinate(req.query.lat, -90, 90, 'enlem');
    const lng = parseCoordinate(req.query.lng, -180, 180, 'boylam');
    const radius = parseRadius(req.query.radius);
    const requestedLimit = Number(req.query.limit || 30);
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 30));
    const reports = await RoadReport.find({
        expiresAt: { $gt: new Date() },
        location: { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radius } }
    }).limit(limit).lean();
    res.status(200).json({ status: 'success', data: reports.map(formatRoadReport) });
});

export const createRoadReport = catchAsync(async (req, res, next) => {
    const category = String(req.body?.category || '').trim().toLowerCase();
    if (!roadReportCategories.has(category)) return next(new AppError('Gecerli bir yol raporu kategorisi gereklidir.', 400));

    const location = req.body?.location || {};
    const lat = parseCoordinate(location.lat ?? req.body?.lat, -90, 90, 'enlem');
    const lng = parseCoordinate(location.lng ?? req.body?.lng, -180, 180, 'boylam');
    const description = String(req.body?.description || '').trim();
    if (description.length > 600) return next(new AppError('Rapor aciklamasi en fazla 600 karakter olabilir.', 400));

    const config = geoConfig();
    const expiresAt = resolveRoadReportExpiry({
        category,
        ttlHours: req.body?.ttlHours,
        expiresAt: req.body?.expiresAt,
        maxTtlHours: config.limits.roadReportTtlHours
    });
    if (!expiresAt) return next(new AppError('Rapor bitis zamani gelecekte olmalidir.', 400));

    const report = await RoadReport.create({
        reporter: req.user.id,
        category,
        description,
        location: { type: 'Point', coordinates: [lng, lat] },
        expiresAt
    });
    res.status(201).json({ status: 'success', data: formatRoadReport(report) });
});

export const getRouteIntelligence = catchAsync(async (req, res, next) => {
    try {
        const data = await buildRouteIntelligence({
            start: req.body?.start,
            end: req.body?.end,
            geometry: req.body?.geometry,
            preferences: req.body?.preferences,
            requestId: req.id || req.headers['x-request-id'] || 'route-intelligence'
        });
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        next(error instanceof AppError ? error : new AppError(error.message || 'Rota zekasi olusturulamadi.', error.statusCode || 422));
    }
});

export const getProviderHealth = (req, res) => {
    const config = geoConfig();
    res.status(200).json({
        status: 'success',
        data: {
            providers: {
            osm: config.features.poi ? 'configured' : 'disabled',
            routing: config.routingProvider || 'disabled',
            weather: config.features.weather ? 'configured' : 'disabled',
            elevation: config.features.elevation ? 'configured' : 'disabled',
            wildfire: config.features.wildfire
                ? (process.env.NASA_FIRMS_MAP_KEY?.trim() ? 'configured' : 'not_configured')
                : 'disabled',
            traffic: config.features.traffic
                ? (process.env.TOMTOM_API_KEY?.trim() ? 'configured' : 'not_configured')
                : 'disabled',
            overture: config.features.overture
                ? (config.providers.overtureUrl ? 'configured' : 'not_configured')
                : 'disabled',
            officialData: config.features.officialData ? 'no_approved_provider' : 'disabled',
            discovery: config.features.discovery ? 'configured' : 'disabled'
            },
            metrics: getGeoProviderMetrics(),
            cache: getGeoCacheMetrics()
        }
    });
};
