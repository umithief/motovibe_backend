import { geoConfig } from '../geoConfig.js';
import { cacheKey, getCached, setCached } from '../geoCache.js';
import { requestJson } from '../geoHttpClient.js';

const average = (values) => {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return null;
    return valid.reduce((total, value) => total + value, 0) / valid.length;
};

const toNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const selectRepresentativeSamples = (samples, limit) => {
    if (samples.length <= limit) return samples;
    return Array.from({ length: limit }, (_, index) => {
        const position = Math.round((index * (samples.length - 1)) / Math.max(limit - 1, 1));
        return samples[position];
    });
};

export const summarizeTrafficSegments = (segments) => {
    const valid = segments.filter((segment) => Number.isFinite(segment.currentSpeed) && Number.isFinite(segment.freeFlowSpeed));
    if (!valid.length) return { available: false, reason: 'provider_unavailable', sampledPoints: 0 };

    const currentSpeedKph = average(valid.map((segment) => segment.currentSpeed));
    const freeFlowSpeedKph = average(valid.map((segment) => segment.freeFlowSpeed));
    const congestionPercent = freeFlowSpeedKph && currentSpeedKph !== null
        ? Math.max(0, Math.min(100, ((freeFlowSpeedKph - currentSpeedKph) / freeFlowSpeedKph) * 100))
        : null;
    const closures = valid.filter((segment) => segment.roadClosure === true).length;

    return {
        available: true,
        currentSpeedKph: currentSpeedKph === null ? null : Number(currentSpeedKph.toFixed(1)),
        freeFlowSpeedKph: freeFlowSpeedKph === null ? null : Number(freeFlowSpeedKph.toFixed(1)),
        congestionPercent: congestionPercent === null ? null : Math.round(congestionPercent),
        confidence: average(valid.map((segment) => segment.confidence)),
        sampledPoints: valid.length,
        roadClosureCount: closures,
        status: closures > 0 ? 'closure_reported' : (congestionPercent ?? 0) >= 55 ? 'heavy' : (congestionPercent ?? 0) >= 25 ? 'moderate' : 'flowing',
        attribution: ['TomTom Traffic']
    };
};

export const getRouteTraffic = async ({ samples, requestId = 'unknown' }) => {
    if (!samples?.length) return { available: false, reason: 'route_geometry_missing' };
    const apiKey = process.env.TOMTOM_API_KEY?.trim();
    if (!apiKey) return { available: false, reason: 'not_configured' };

    const config = geoConfig();
    const points = selectRepresentativeSamples(samples, config.limits.trafficSampleCount);
    const key = cacheKey('traffic', points.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`).join('|'));
    const cached = await getCached(key);
    if (cached) return { ...cached, cached: true };

    const results = await Promise.allSettled(points.map(async (point) => {
        const url = new URL(`${config.providers.tomTomUrl}/traffic/services/4/flowSegmentData/absolute/10/json`);
        url.search = new URLSearchParams({
            key: apiKey,
            point: `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`,
            unit: 'kmph'
        }).toString();
        const payload = await requestJson({ provider: 'tomtom_traffic', url, requestId, retries: 1, timeoutMs: 6000 });
        const data = payload?.flowSegmentData || {};
        return {
            currentSpeed: toNumber(data.currentSpeed),
            freeFlowSpeed: toNumber(data.freeFlowSpeed),
            confidence: toNumber(data.confidence),
            roadClosure: data.roadClosure === true
        };
    }));
    const traffic = summarizeTrafficSegments(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
    if (!traffic.available) {
        const authorizationFailure = results.some((result) => result.status === 'rejected' && [401, 403].includes(result.reason?.statusCode));
        return { ...traffic, reason: authorizationFailure ? 'not_authorized' : traffic.reason };
    }
    await setCached(key, traffic, 3 * 60);
    return traffic;
};
