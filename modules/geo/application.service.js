import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import GeoPoi from "./model.js";
import RoadReport from "./RoadReport.model.js";

import AppError from "../../utils/appError.js";
import { geoConfig } from "./geoConfig.js";
import { roadReportCategories, resolveRoadReportExpiry } from "./roadReportPolicy.js";
import { getGeoProviderMetrics } from "./geoProviderMonitor.js";
import { getGeoCacheMetrics } from "./geoCache.js";

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

export const getNearbyPois = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const lat = parseCoordinate(input.query.lat, -90, 90, 'enlem');
    const lng = parseCoordinate(input.query.lng, -180, 180, 'boylam');
    const radius = parseRadius(input.query.radius);
    const config = geoConfig();
    const requestedLimit = Number(input.query.limit || 50);
    const limit = Math.max(1, Math.min(config.limits.poiLimit, Number.isFinite(requestedLimit) ? requestedLimit : 50));
    const categories = typeof input.query.categories === 'string'
        ? input.query.categories.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    const query = {
        location: { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radius } },
        ...(categories.length ? { category: { $in: categories } } : {})
    };
    const pois = await GeoPoi.find(query).limit(limit).lean();
    respond({
        status: 'success',
        data: pois.map((poi) => ({
            id: poi._id.toString(), source: poi.source, name: poi.name || undefined, category: poi.category,
            location: { lng: poi.location.coordinates[0], lat: poi.location.coordinates[1] },
            metadata: poi.metadata, attribution: poi.attribution
        }))
    },200);

    return response;
};

export const getNearbyRoadReports = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const lat = parseCoordinate(input.query.lat, -90, 90, 'enlem');
    const lng = parseCoordinate(input.query.lng, -180, 180, 'boylam');
    const radius = parseRadius(input.query.radius);
    const requestedLimit = Number(input.query.limit || 30);
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 30));
    const reports = await RoadReport.find({
        expiresAt: { $gt: new Date() },
        location: { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radius } }
    }).limit(limit).lean();
    respond({ status: 'success', data: reports.map(formatRoadReport) },200);

    return response;
};

export const createRoadReport = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const category = String(input.body?.category || '').trim().toLowerCase();
    if (!roadReportCategories.has(category)) return throwError(new AppError('Gecerli bir yol raporu kategorisi gereklidir.', 400));

    const location = input.body?.location || {};
    const lat = parseCoordinate(location.lat ?? input.body?.lat, -90, 90, 'enlem');
    const lng = parseCoordinate(location.lng ?? input.body?.lng, -180, 180, 'boylam');
    const description = String(input.body?.description || '').trim();
    if (description.length > 600) return throwError(new AppError('Rapor aciklamasi en fazla 600 karakter olabilir.', 400));

    const config = geoConfig();
    const expiresAt = resolveRoadReportExpiry({
        category,
        ttlHours: input.body?.ttlHours,
        expiresAt: input.body?.expiresAt,
        maxTtlHours: config.limits.roadReportTtlHours
    });
    if (!expiresAt) return throwError(new AppError('Rapor bitis zamani gelecekte olmalidir.', 400));

    const report = await RoadReport.create({
        reporter: input.user.id,
        category,
        description,
        location: { type: 'Point', coordinates: [lng, lat] },
        expiresAt
    });
    respond({ status: 'success', data: formatRoadReport(report) },201);

    return response;
};

export const getRouteIntelligence = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { buildRouteIntelligence }=await import('./service.js');
        const data = await buildRouteIntelligence({
            start: input.body?.start,
            end: input.body?.end,
            geometry: input.body?.geometry,
            preferences: input.body?.preferences,
            requestId: input.id || input.headers['x-request-id'] || 'route-intelligence'
        });
        respond({ status: 'success', data },200);
    } catch (error) {
        throwError(error instanceof AppError ? error : new AppError(error.message || 'Rota zekasi olusturulamadi.', error.statusCode || 422));
    }

    return response;
};

export const getProviderHealth = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const config = geoConfig();
    respond({
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
    },200);

    return response;
};
