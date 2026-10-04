import { geoConfig } from '../geoConfig.js';
import { requestJson } from '../geoHttpClient.js';
import { haversineMeters, isValidCoordinate } from '../utils/geoMath.js';

const categories = new Set(['fuel', 'motorcycle_service', 'motorcycle_shop', 'parking', 'cafe', 'restaurant', 'camp', 'viewpoint', 'hotel', 'hospital', 'pharmacy', 'police', 'tourism', 'water', 'toilet', 'other']);

const normalizedName = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const isDuplicate = (candidate, existingPois) => existingPois.some((poi) => {
    const existingLocation = poi?.location;
    const sameName = normalizedName(candidate.name) && normalizedName(candidate.name) === normalizedName(poi?.name);
    return sameName && isValidCoordinate(existingLocation) && haversineMeters(candidate.location, existingLocation) < 120;
});

export const normalizeOverturePois = ({ pois, existingPois = [] }) => (Array.isArray(pois) ? pois : [])
    .map((poi) => {
        const location = { lat: Number(poi?.location?.lat ?? poi?.lat), lng: Number(poi?.location?.lng ?? poi?.lng ?? poi?.lon) };
        if (!isValidCoordinate(location)) return null;
        return {
            id: `overture:${String(poi?.id || poi?.sourceId || `${location.lat}:${location.lng}`)}`,
            source: 'overture',
            name: String(poi?.name || '').trim() || 'Rota noktası',
            category: categories.has(poi?.category) ? poi.category : 'other',
            location,
            distanceFromRouteMeters: Number.isFinite(Number(poi?.distanceFromRouteMeters)) ? Number(poi.distanceFromRouteMeters) : undefined,
            metadata: { sourceId: poi?.id || poi?.sourceId || undefined },
            attribution: ['Overture Maps Foundation']
        };
    })
    .filter(Boolean)
    .filter((poi) => !isDuplicate(poi, existingPois));

// Overture has no unauthenticated public route-POI endpoint. This adapter only
// accepts a deliberately configured, normalized server-side endpoint.
export const getRouteOverturePois = async ({ samples, existingPois = [], requestId = 'unknown' }) => {
    if (!samples?.length) return { available: false, reason: 'route_geometry_missing', pois: [] };
    const { providers } = geoConfig();
    if (!providers.overtureUrl) return { available: false, reason: 'not_configured', pois: [] };
    const payload = await requestJson({
        provider: 'overture',
        url: providers.overtureUrl,
        options: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ samples, limit: 100 })
        },
        requestId,
        retries: 1
    });
    const pois = normalizeOverturePois({ pois: payload?.pois || payload?.data || [], existingPois });
    return { available: true, pois, attribution: ['Overture Maps Foundation'] };
};
