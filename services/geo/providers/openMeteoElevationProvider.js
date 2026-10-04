import { geoConfig } from '../geoConfig.js';
import { cacheKey, getCached, setCached } from '../geoCache.js';
import { requestJson } from '../geoHttpClient.js';

const finiteElevations = (values) => (values || [])
    .map((value) => Number(value))
    .filter(Number.isFinite);

export const summarizeElevation = ({ samples, elevations }) => {
    const valid = finiteElevations(elevations);
    if (!valid.length) return { available: false, reason: 'elevation_missing' };

    let ascent = 0;
    let descent = 0;
    for (let index = 1; index < valid.length; index += 1) {
        const delta = valid[index] - valid[index - 1];
        if (delta > 0) ascent += delta;
        if (delta < 0) descent += Math.abs(delta);
    }

    return {
        available: true,
        source: 'open_meteo_copernicus_dem_glo_90',
        min: Math.round(Math.min(...valid)),
        max: Math.round(Math.max(...valid)),
        ascent: Math.round(ascent),
        descent: Math.round(descent),
        sampledPoints: valid.length,
        attribution: ['Open-Meteo', 'Copernicus DEM GLO-90'],
        profile: valid.map((elevation, index) => ({
            lat: Number(samples[index]?.lat.toFixed(5)),
            lng: Number(samples[index]?.lng.toFixed(5)),
            elevation: Math.round(elevation)
        }))
    };
};

export const getRouteElevation = async ({ samples, requestId = 'unknown' }) => {
    if (!samples?.length) return { available: false, reason: 'route_geometry_missing' };
    const key = cacheKey('elevation', samples.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`).join('|'));
    const cached = await getCached(key);
    if (cached) return { ...cached, cached: true };

    const { providers } = geoConfig();
    const url = new URL(`${providers.openMeteoElevationUrl}/elevation`);
    url.search = new URLSearchParams({
        latitude: samples.map((point) => point.lat.toFixed(5)).join(','),
        longitude: samples.map((point) => point.lng.toFixed(5)).join(',')
    }).toString();
    const payload = await requestJson({ provider: 'open_meteo_elevation', url, requestId, retries: 1 });
    const summary = summarizeElevation({ samples, elevations: payload?.elevation });
    if (summary.available) await setCached(key, summary, 24 * 60 * 60);
    return summary;
};
