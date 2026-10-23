import { geoConfig } from '../geoConfig.js';
import { cacheKey, getCached, setCached } from '../geoCache.js';
import { requestText } from '../geoHttpClient.js';
import { haversineMeters, isValidCoordinate } from '../utils/geoMath.js';

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseCsvLine = (line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') {
                value += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === ',' && !quoted) {
            values.push(value.trim());
            value = '';
        } else {
            value += character;
        }
    }
    values.push(value.trim());
    return values;
};

export const parseFirmsCsv = (csv) => {
    const lines = String(csv || '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
        const lat = toNumber(record.latitude);
        const lng = toNumber(record.longitude);
        if (!isValidCoordinate({ lat, lng })) return null;
        return {
            lat,
            lng,
            confidence: record.confidence || undefined,
            brightness: toNumber(record.bright_ti4 ?? record.brightness),
            fireRadiativePower: toNumber(record.frp),
            acquiredAt: [record.acq_date, record.acq_time].filter(Boolean).join(' ').trim() || undefined,
            dayNight: record.daynight || undefined
        };
    }).filter(Boolean);
};

const routeBounds = (samples, corridorKm) => {
    const latitudes = samples.map((point) => point.lat);
    const longitudes = samples.map((point) => point.lng);
    const averageLatitude = latitudes.reduce((sum, latitude) => sum + latitude, 0) / latitudes.length;
    const latitudePadding = corridorKm / 111.32;
    const longitudePadding = corridorKm / Math.max(111.32 * Math.cos(averageLatitude * Math.PI / 180), 1);
    return {
        west: Math.max(-180, Math.min(...longitudes) - longitudePadding),
        south: Math.max(-90, Math.min(...latitudes) - latitudePadding),
        east: Math.min(180, Math.max(...longitudes) + longitudePadding),
        north: Math.min(90, Math.max(...latitudes) + latitudePadding)
    };
};

const serializeBounds = (bounds) => [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(3)).join(',');

export const summarizeWildfireDetections = ({ detections, samples, routeCorridorKm }) => {
    const corridorMeters = routeCorridorKm * 1000;
    const withDistance = detections.map((detection) => ({
        ...detection,
        distanceFromRouteKm: Math.min(...samples.map((sample) => haversineMeters(sample, detection))) / 1000
    })).filter((detection) => Number.isFinite(detection.distanceFromRouteKm));
    const nearbyDetections = withDistance
        .filter((detection) => detection.distanceFromRouteKm <= corridorMeters / 1000)
        .sort((first, second) => first.distanceFromRouteKm - second.distanceFromRouteKm)
        .slice(0, 25)
        .map((detection) => ({ ...detection, distanceFromRouteKm: Number(detection.distanceFromRouteKm.toFixed(1)) }));
    const nearestDetectionDistanceKm = withDistance.length
        ? Number(Math.min(...withDistance.map((detection) => detection.distanceFromRouteKm)).toFixed(1))
        : null;
    return { nearbyDetections, nearestDetectionDistanceKm };
};

export const getRouteWildfire = async ({ samples, requestId = 'unknown' }) => {
    if (!samples?.length) return { available: false, reason: 'route_geometry_missing' };
    const mapKey = process.env.NASA_FIRMS_MAP_KEY?.trim();
    if (!mapKey) return { available: false, reason: 'not_configured' };

    const { limits, providers } = geoConfig();
    const bounds = routeBounds(samples, limits.wildfireRouteCorridorKm);
    const serializedBounds = serializeBounds(bounds);
    const key = cacheKey('wildfire', providers.firmsSource, limits.wildfireDays, serializedBounds);
    const cached = await getCached(key);
    if (cached) return { ...cached, cached: true };

    const url = new URL(`${providers.firmsUrl}/area/csv/${encodeURIComponent(mapKey)}/${encodeURIComponent(providers.firmsSource)}/${serializedBounds}/${limits.wildfireDays}`);
    const csv = await requestText({ provider: 'nasa_firms', url, requestId, timeoutMs: 12000, retries: 1 });
    const detections = parseFirmsCsv(csv);
    const { nearbyDetections, nearestDetectionDistanceKm } = summarizeWildfireDetections({
        detections,
        samples,
        routeCorridorKm: limits.wildfireRouteCorridorKm
    });
    const summary = {
        available: true,
        status: nearbyDetections.length ? 'warning' : 'clear',
        source: providers.firmsSource,
        dayRange: limits.wildfireDays,
        routeCorridorKm: limits.wildfireRouteCorridorKm,
        detectionCount: detections.length,
        nearbyDetections,
        nearestDetectionDistanceKm,
        attribution: ['NASA FIRMS active fire / thermal anomaly detections']
    };
    await setCached(key, summary, 15 * 60);
    return summary;
};
