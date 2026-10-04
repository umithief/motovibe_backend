import { geoConfig } from '../geoConfig.js';
import { cacheKey, getCached, setCached } from '../geoCache.js';
import { requestJson } from '../geoHttpClient.js';
import { isValidCoordinate } from '../utils/geoMath.js';

const representative = (samples, limit = 5) => samples.length <= limit ? samples : Array.from({ length: limit }, (_, index) => samples[Math.round(index * (samples.length - 1) / (limit - 1))]);

const locationFor = (geometry) => {
    const coordinates = geometry?.coordinates;
    const point = geometry?.type === 'Point' ? coordinates : coordinates?.[0];
    const location = { lng: Number(point?.[0]), lat: Number(point?.[1]) };
    return isValidCoordinate(location) ? location : null;
};

export const normalizeTomTomIncidents = (incidents) => (Array.isArray(incidents) ? incidents : []).map((incident) => {
    const properties = incident?.properties || {};
    const location = locationFor(incident?.geometry);
    if (!location) return null;
    return {
        id: `tomtom:${properties.id || `${location.lat}:${location.lng}`}`,
        category: Number(properties.iconCategory) || 0,
        description: properties.events?.[0]?.description || properties.from || 'Trafik olayı',
        delaySeconds: Number(properties.delay) || 0,
        location
    };
}).filter(Boolean);

export const getRouteTrafficIncidents = async ({ samples, requestId = 'unknown' }) => {
    if (!samples?.length) return { available: false, reason: 'route_geometry_missing', incidents: [] };
    const keyValue = process.env.TOMTOM_API_KEY?.trim();
    if (!keyValue) return { available: false, reason: 'not_configured', incidents: [] };
    const points = representative(samples);
    const key = cacheKey('traffic-incidents', points.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`).join('|'));
    const cached = await getCached(key);
    if (cached) return { ...cached, cached: true };
    const { providers } = geoConfig();
    const results = await Promise.allSettled(points.map(async (point) => {
        const delta = 0.04;
        const url = new URL(`${providers.tomTomUrl}/traffic/services/5/incidentDetails`);
        url.search = new URLSearchParams({
            key: keyValue,
            bbox: `${point.lng - delta},${point.lat - delta},${point.lng + delta},${point.lat + delta}`,
            fields: '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,delay,events{description}}}}',
            language: 'tr-TR',
            timeValidityFilter: 'present'
        }).toString();
        const payload = await requestJson({ provider: 'tomtom_incidents', url, requestId, retries: 1, timeoutMs: 6000 });
        return normalizeTomTomIncidents(payload?.incidents);
    }));
    const unique = new Map();
    results.filter((item) => item.status === 'fulfilled').flatMap((item) => item.value).forEach((incident) => unique.set(incident.id, incident));
    const incidents = [...unique.values()].slice(0, 30);
    const result = { available: results.some((item) => item.status === 'fulfilled'), incidents, attribution: ['TomTom Traffic'] };
    if (!result.available) return { ...result, reason: 'provider_unavailable' };
    await setCached(key, result, 2 * 60);
    return result;
};
