import { geoConfig } from '../geoConfig.js';
import { cacheKey, getCached, setCached } from '../geoCache.js';
import { requestJson } from '../geoHttpClient.js';
import { haversineMeters, isValidCoordinate } from '../utils/geoMath.js';

const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const selectSamples = (samples, maximum) => {
    if (samples.length <= maximum) return samples;
    return Array.from({ length: maximum }, (_, index) => {
        const position = Math.round((samples.length - 1) * index / Math.max(1, maximum - 1));
        return samples[position];
    });
};

const trimDescription = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return undefined;
    return normalized.length > 140 ? `${normalized.slice(0, 137).trimEnd()}…` : normalized;
};

const entityLabel = (entity) => entity?.labels?.tr?.value || entity?.labels?.en?.value || entity?.id;
const entityDescription = (entity) => entity?.descriptions?.tr?.value || entity?.descriptions?.en?.value;

export const normalizeWikidataDiscovery = ({ pages, entities, existingPois = [] }) => {
    const seen = new Map();
    for (const page of pages || []) {
        const id = String(page?.title || '').trim();
        const entity = entities?.[id];
        const name = entityLabel(entity);
        const lat = Number(page?.lat);
        const lng = Number(page?.lon);
        if (!id || !name || !isValidCoordinate({ lat, lng })) continue;

        const candidate = {
            id: `wikidata:${id}`,
            source: 'wikidata',
            name,
            description: trimDescription(entityDescription(entity)),
            category: 'tourism',
            location: { lat, lng },
            distanceFromRouteMeters: Number(page?.dist) || undefined,
            url: `https://www.wikidata.org/wiki/${encodeURIComponent(id)}`,
            attribution: ['Wikidata (CC0)']
        };
        const duplicate = existingPois.some((poi) => {
            const poiName = normalizeName(poi?.name || poi?.metadata?.name);
            const sameName = poiName && poiName === normalizeName(candidate.name);
            const poiLocation = poi?.location;
            const poiLat = Number(poiLocation?.lat ?? poiLocation?.coordinates?.[1]);
            const poiLng = Number(poiLocation?.lng ?? poiLocation?.coordinates?.[0]);
            const samePosition = isValidCoordinate({ lat: poiLat, lng: poiLng }) &&
                haversineMeters({ lat: poiLat, lng: poiLng }, candidate.location) <= 120;
            return sameName || samePosition;
        });
        if (duplicate) continue;

        const key = `${normalizeName(candidate.name)}:${candidate.location.lat.toFixed(3)}:${candidate.location.lng.toFixed(3)}`;
        const previous = seen.get(key);
        if (!previous || (candidate.distanceFromRouteMeters || Infinity) < (previous.distanceFromRouteMeters || Infinity)) {
            seen.set(key, candidate);
        }
    }
    return [...seen.values()]
        .sort((first, second) => (first.distanceFromRouteMeters || Infinity) - (second.distanceFromRouteMeters || Infinity));
};

export const getRouteDiscovery = async ({ samples, existingPois = [], requestId = 'unknown' }) => {
    if (!samples?.length) return { available: false, reason: 'route_geometry_missing' };
    const { limits, providers } = geoConfig();
    const representativeSamples = selectSamples(samples, limits.discoverySampleCount);
    const key = cacheKey(
        'discovery',
        representativeSamples.map((point) => `${point.lat.toFixed(2)},${point.lng.toFixed(2)}`).join('|')
    );
    const cached = await getCached(key);
    if (cached) return { ...cached, cached: true };

    const headers = { 'User-Agent': 'MotoVibe/1.0 (+https://motovibe.app)' };
    const responses = await Promise.allSettled(representativeSamples.map(async (point) => {
        const url = new URL(providers.wikidataUrl);
        url.search = new URLSearchParams({
            action: 'query',
            list: 'geosearch',
            gscoord: `${point.lat.toFixed(5)}|${point.lng.toFixed(5)}`,
            gsradius: String(limits.discoveryRadiusMeters),
            gslimit: '8',
            gsnamespace: '0',
            format: 'json'
        }).toString();
        const payload = await requestJson({ provider: 'wikidata', url, options: { headers }, requestId, retries: 1 });
        return payload?.query?.geosearch || [];
    }));
    const pages = responses
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value)
        .filter((page) => /^Q\d+$/.test(String(page?.title || '')));
    if (!responses.some((result) => result.status === 'fulfilled')) {
        return { available: false, reason: 'provider_unavailable' };
    }

    const ids = [...new Set(pages.map((page) => page.title))].slice(0, limits.discoveryLimit);
    let entities = {};
    if (ids.length) {
        const entityUrl = new URL(providers.wikidataUrl);
        entityUrl.search = new URLSearchParams({
            action: 'wbgetentities',
            ids: ids.join('|'),
            props: 'labels|descriptions',
            languages: 'tr|en',
            format: 'json'
        }).toString();
        const payload = await requestJson({ provider: 'wikidata', url: entityUrl, options: { headers }, requestId, retries: 1 });
        entities = payload?.entities || {};
    }
    const places = normalizeWikidataDiscovery({ pages, entities, existingPois }).slice(0, limits.discoveryLimit);
    const summary = {
        available: true,
        sampledPoints: representativeSamples.length,
        places,
        attribution: ['Wikidata (CC0)']
    };
    await setCached(key, summary, 6 * 60 * 60);
    return summary;
};
