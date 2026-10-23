import { getMapboxDirectionsAccessToken } from '../../../config/env.js';
import { geoConfig } from '../geoConfig.js';
import { requestJson, GeoProviderError } from '../geoHttpClient.js';
import { isValidCoordinate } from '../utils/geoMath.js';
import { modeCapability, normalizeRoutePreferences } from '../routeModePolicy.js';

const normalizePoint = (point) => ({ lat: Number(point?.lat), lng: Number(point?.lng) });

const validateEndpoints = (start, end) => {
    const normalizedStart = normalizePoint(start);
    const normalizedEnd = normalizePoint(end);
    if (!isValidCoordinate(normalizedStart) || !isValidCoordinate(normalizedEnd)) {
        throw new GeoProviderError('routing', 'Gecerli baslangic ve bitis koordinatlari gereklidir.', { statusCode: 400 });
    }
    return { start: normalizedStart, end: normalizedEnd };
};

const mapboxRoute = async ({ start, end, preferences, requestId }) => {
    const token = getMapboxDirectionsAccessToken();
    if (!token) throw new GeoProviderError('mapbox', 'Mapbox rota saglayicisi yapilandirilmamis.', { statusCode: 503 });
    const coordinates = `${start.lng},${start.lat};${end.lng},${end.lat}`;
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
    const exclusions = [
        preferences.avoidHighways ? 'motorway' : null,
        preferences.avoidTolls ? 'toll' : null,
        preferences.avoidFerries ? 'ferry' : null,
        preferences.avoidUnpaved ? 'unpaved' : null
    ].filter(Boolean);
    url.search = new URLSearchParams({
        access_token: token,
        alternatives: String(preferences.alternatives),
        overview: 'full',
        geometries: 'geojson',
        steps: 'false',
        ...(exclusions.length ? { exclude: exclusions.join(',') } : {})
    }).toString();
    const payload = await requestJson({ provider: 'mapbox', url, requestId, retries: 1 });
    return (payload.routes || []).map((route) => ({
        geometry: route.geometry,
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        provider: 'mapbox',
        mode: modeCapability({ mode: preferences.mode, provider: 'mapbox' })
    }));
};

const openRouteServiceRoute = async ({ start, end, preferences, requestId }) => {
    const key = process.env.OPENROUTESERVICE_API_KEY?.trim();
    if (!key) throw new GeoProviderError('openrouteservice', 'OpenRouteService yapilandirilmamis.', { statusCode: 503 });
    const { providers } = geoConfig();
    const payload = await requestJson({
        provider: 'openrouteservice',
        url: `${providers.openRouteServiceUrl}/v2/directions/driving-car/geojson`,
        options: {
            method: 'POST',
            headers: { Authorization: key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
                alternative_routes: { target_count: preferences.alternatives ? 2 : 0 },
                ...(preferences.avoidHighways || preferences.avoidTolls || preferences.avoidFerries
                    ? { options: { avoid_features: [
                        ...(preferences.avoidHighways ? ['highways'] : []),
                        ...(preferences.avoidTolls ? ['tollways'] : []),
                        ...(preferences.avoidFerries ? ['ferries'] : [])
                    ] } }
                    : {})
            })
        },
        requestId,
        retries: 1
    });
    return (payload.features || []).map((feature) => ({
        geometry: feature.geometry,
        distanceMeters: Math.round(feature.properties?.summary?.distance || 0),
        durationSeconds: Math.round(feature.properties?.summary?.duration || 0),
        provider: 'openrouteservice',
        mode: modeCapability({ mode: preferences.mode, provider: 'openrouteservice' })
    })).filter((route) => route.geometry?.coordinates?.length >= 2 && route.distanceMeters > 0);
};

const valhallaRoute = async ({ start, end, preferences, requestId }) => {
    const { providers } = geoConfig();
    if (!providers.valhallaUrl) throw new GeoProviderError('valhalla', 'Valhalla yapilandirilmamis.', { statusCode: 503 });
    const request = { locations: [{ lat: start.lat, lon: start.lng }, { lat: end.lat, lon: end.lng }], costing: 'motorcycle', units: 'kilometers', shape_format: 'geojson' };
    const url = new URL(`${providers.valhallaUrl}/route`);
    url.searchParams.set('json', JSON.stringify(request));
    const payload = await requestJson({ provider: 'valhalla', url, requestId, retries: 1 });
    const trip = payload?.trip;
    const coordinates = trip?.legs?.flatMap((leg) => leg?.shape?.coordinates || []) || [];
    if (coordinates.length < 2) throw new GeoProviderError('valhalla', 'Valhalla gecersiz rota geometrisi dondurdu.', { statusCode: 502 });
    return [{ geometry: { type: 'LineString', coordinates }, distanceMeters: Math.round((trip.summary?.length || 0) * 1000), durationSeconds: Math.round(trip.summary?.time || 0), provider: 'valhalla', mode: modeCapability({ mode: preferences.mode, provider: 'valhalla' }) }];
};

export const routingProvider = {
    async calculateRoute({ start, end, alternatives = false, preferences = {}, requestId }) {
        const points = validateEndpoints(start, end);
        const normalizedPreferences = normalizeRoutePreferences({ ...preferences, alternatives });
        const provider = geoConfig().routingProvider;
        if (provider === 'openrouteservice') return openRouteServiceRoute({ ...points, preferences: normalizedPreferences, requestId });
        if (provider === 'valhalla') return valhallaRoute({ ...points, preferences: normalizedPreferences, requestId });
        return mapboxRoute({ ...points, preferences: normalizedPreferences, requestId });
    },
    async getAlternativeRoutes(input) { return this.calculateRoute({ ...input, alternatives: true }); },
    async mapMatch() { throw new GeoProviderError('routing', 'Map matching bu saglayici icin henuz etkin degil.', { statusCode: 501 }); },
    async getRouteMatrix() { throw new GeoProviderError('routing', 'Route matrix bu saglayici icin henuz etkin degil.', { statusCode: 501 }); }
};
