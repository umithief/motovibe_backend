import { geoConfig } from '../geoConfig.js';
import { requestJson } from '../geoHttpClient.js';
import { isValidCoordinate } from '../utils/geoMath.js';

const categoryForTags = (tags = {}) => {
    if (tags.amenity === 'fuel') return 'fuel';
    if (tags.shop === 'motorcycle') return 'motorcycle_shop';
    if (tags['service:motorcycle'] === 'yes' || tags.craft === 'motorcycle_repair') return 'motorcycle_service';
    if (tags.amenity === 'parking') return 'parking';
    if (tags.amenity === 'cafe') return 'cafe';
    if (tags.amenity === 'restaurant') return 'restaurant';
    if (tags.tourism === 'camp_site') return 'camp';
    if (tags.tourism === 'viewpoint') return 'viewpoint';
    if (tags.amenity === 'hospital') return 'hospital';
    if (tags.amenity === 'pharmacy') return 'pharmacy';
    if (tags.amenity === 'police') return 'police';
    if (tags.amenity === 'drinking_water') return 'water';
    if (tags.amenity === 'toilets') return 'toilet';
    if (tags.tourism) return 'tourism';
    return 'other';
};

export const normalizeOverpassElement = (element) => {
    const lat = Number(element?.lat ?? element?.center?.lat);
    const lng = Number(element?.lon ?? element?.center?.lon);
    const location = { lat, lng };
    if (!isValidCoordinate(location)) return null;
    const tags = element.tags || {};
    return {
        source: 'openstreetmap',
        sourceId: `${element.type}/${element.id}`,
        name: tags.name || '',
        normalizedName: (tags.name || '').trim().toLowerCase(),
        category: categoryForTags(tags),
        location: { type: 'Point', coordinates: [lng, lat] },
        metadata: { osmType: element.type, osmId: element.id, tags },
        attribution: ['© OpenStreetMap contributors']
    };
};

export const fetchOverpassPois = async ({ bbox, requestId = 'import' }) => {
    const [south, west, north, east] = bbox.map(Number);
    if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) {
        throw new Error('Gecerli bir bbox gereklidir.');
    }
    const query = `[out:json][timeout:60];(nwr[amenity~"fuel|parking|cafe|restaurant|hospital|pharmacy|police|drinking_water|toilets"](${south},${west},${north},${east});nwr[shop="motorcycle"](${south},${west},${north},${east});nwr[tourism~"camp_site|viewpoint|attraction|museum"](${south},${west},${north},${east}););out center tags;`;
    const { providers } = geoConfig();
    const payload = await requestJson({
        provider: 'overpass',
        url: providers.overpassUrl,
        options: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'MotoVibeGeoImporter/1.0 (+https://motovibe.app)'
            },
            body: new URLSearchParams({ data: query })
        },
        timeoutMs: 70000,
        retries: 1,
        requestId
    });
    return (payload?.elements || []).map(normalizeOverpassElement).filter(Boolean);
};
