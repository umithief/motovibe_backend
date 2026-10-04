import GeoPoi from '../../models/GeoPoi.js';
import RoadReport from '../../models/RoadReport.js';
import { geoConfig } from './geoConfig.js';
import { analyzeCurvature, isValidCoordinate, routeDistanceMeters, sampleRoute } from './utils/geoMath.js';
import { getRouteWeather } from './providers/openMeteoProvider.js';
import { getRouteElevation } from './providers/openMeteoElevationProvider.js';
import { getRouteWildfire } from './providers/nasaFirmsProvider.js';
import { getRouteDiscovery } from './providers/wikidataDiscoveryProvider.js';
import { getRouteTraffic } from './providers/tomTomTrafficProvider.js';
import { getRouteOverturePois } from './providers/overtureProvider.js';
import { getOfficialRoadAlerts } from './providers/officialDataProvider.js';
import { getRouteTrafficIncidents } from './providers/tomTomIncidentsProvider.js';
import { normalizeRoutePreferences } from './routeModePolicy.js';
import { routingProvider } from './providers/routingProvider.js';

const poiCategories = ['fuel', 'motorcycle_service', 'motorcycle_shop', 'parking', 'cafe', 'restaurant', 'camp', 'viewpoint', 'hotel', 'hospital', 'pharmacy', 'police', 'tourism', 'water', 'toilet', 'other'];

const normalizeCoordinates = (raw) => (raw || []).map((point) => {
    if (Array.isArray(point)) return { lng: Number(point[0]), lat: Number(point[1]) };
    return { lat: Number(point?.lat), lng: Number(point?.lng ?? point?.lon) };
}).filter(isValidCoordinate);

const toMotovibePoi = (poi, routePoint) => ({
    id: poi._id.toString(),
    source: poi.source,
    name: poi.name || undefined,
    category: poi.category,
    location: { lng: poi.location.coordinates[0], lat: poi.location.coordinates[1] },
    distanceFromRouteMeters: routePoint?.distance || undefined,
    metadata: poi.metadata,
    attribution: poi.attribution
});

const dedupePois = (pois) => {
    const seen = new Map();
    for (const poi of pois) {
        const key = `${poi.category}:${(poi.name || '').toLowerCase()}:${poi.location.lat.toFixed(4)}:${poi.location.lng.toFixed(4)}`;
        const current = seen.get(key);
        if (!current || (poi.distanceFromRouteMeters || Infinity) < (current.distanceFromRouteMeters || Infinity)) seen.set(key, poi);
    }
    return [...seen.values()];
};

const findPoisNearSamples = async (samples, { limit, radiusMeters }) => {
    const perSampleLimit = Math.max(5, Math.ceil(limit / Math.max(samples.length, 1)));
    const results = await Promise.all(samples.map(async (sample) => {
        const pois = await GeoPoi.find({ location: { $near: { $geometry: { type: 'Point', coordinates: [sample.lng, sample.lat] }, $maxDistance: radiusMeters } } })
            .limit(perSampleLimit)
            .lean();
        return pois.map((poi) => toMotovibePoi(poi));
    }));
    return dedupePois(results.flat()).slice(0, limit);
};

const findRoadReportsNearSamples = async (samples, { limit = 25, radiusMeters = 2000 }) => {
    const results = await Promise.all(samples.map((sample) => RoadReport.find({
        expiresAt: { $gt: new Date() },
        location: { $near: { $geometry: { type: 'Point', coordinates: [sample.lng, sample.lat] }, $maxDistance: radiusMeters } }
    }).limit(limit).lean()));
    const unique = new Map();
    for (const report of results.flat()) unique.set(report._id.toString(), report);
    return [...unique.values()].slice(0, limit);
};

const scoreComponent = (value, fallback = 50) => Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;

export const calculateScenicScore = ({ pois = [], elevation, fallbackPoiCount = 0 }) => {
    const naturalPoiCount = pois.filter((poi) => ['viewpoint', 'tourism', 'camp', 'water'].includes(poi.category)).length;
    const naturalSignal = Math.min(65, naturalPoiCount * 14 || fallbackPoiCount * 5);
    const elevationVariation = elevation?.available ? Math.min(25, Math.max(0, (elevation.max || 0) - (elevation.min || 0)) / 30) : 0;
    return scoreComponent(20 + naturalSignal + elevationVariation);
};

export const calculateRideScore = ({ weather, traffic, curvature, pois = [], poiCount = 0, warnings, elevation, wildfire, weights = geoConfig().rideScoreWeights }) => {
    const weatherScore = weather?.available
        ? scoreComponent(100 - Math.min(60, (weather.precipitation || 0) * 20 + Math.max(0, (weather.windGusts || 0) - 35) * 1.2))
        : null;
    const components = {
        weather: weatherScore,
        traffic: traffic?.available
            ? scoreComponent(100 - (traffic.congestionPercent || 0) - (traffic.roadClosureCount || 0) * 25)
            : null,
        curves: scoreComponent(curvature.curveScore),
        scenery: calculateScenicScore({ pois, elevation, fallbackPoiCount: poiCount }),
        poi: scoreComponent(Math.min(100, poiCount * 10)),
        // Elevation variation is only a small scenic signal, never a safety claim.
        elevation: elevation?.available
            ? scoreComponent(50 + Math.min(30, Math.max(0, (elevation.max || 0) - (elevation.min || 0)) / 40))
            : null,
        // A thermal anomaly is not a road closure. Keep its safety impact modest.
        safety: scoreComponent(100 - warnings.length * 18 - (wildfire?.status === 'warning' ? 10 : 0))
    };
    const available = Object.entries(weights).filter(([name]) => Number.isFinite(components[name]));
    const totalWeight = available.reduce((total, [name]) => total + weights[name], 0);
    const overall = totalWeight ? available.reduce((total, [name]) => total + components[name] * weights[name], 0) / totalWeight : null;
    return { overall: overall === null ? null : Math.round(overall), ...components };
};

export const buildRouteIntelligence = async ({ start, end, geometry, preferences = {}, requestId = 'unknown' }) => {
    const config = geoConfig();
    const routePreferences = normalizeRoutePreferences(preferences);
    let coordinates = normalizeCoordinates(geometry?.coordinates || geometry);
    let provider = null;
    let distanceMeters = routeDistanceMeters(coordinates);
    let durationSeconds = null;

    if (coordinates.length < 2 && start && end) {
        const routes = await routingProvider.calculateRoute({ start, end, alternatives: routePreferences.alternatives, preferences: routePreferences, requestId });
        const route = routes[0];
        coordinates = normalizeCoordinates(route.geometry.coordinates);
        distanceMeters = route.distanceMeters;
        durationSeconds = route.durationSeconds;
        provider = route.provider;
    }
    if (coordinates.length < 2) throw new Error('Rota zekasi icin LineString geometrisi veya baslangic/bitiş gereklidir.');
    if (distanceMeters / 1000 > config.limits.routeDistanceKm) throw new Error('Rota uzunlugu izin verilen siniri asiyor.');

    const samples = sampleRoute(coordinates, config.limits.sampleSpacingKm);
    const [weatherResult, poisResult, elevationResult, reportsResult, wildfireResult, trafficResult, trafficIncidentsResult] = await Promise.allSettled([
        config.features.weather ? getRouteWeather({ samples, requestId }) : Promise.resolve({ available: false, reason: 'disabled' }),
        config.features.poi ? findPoisNearSamples(samples, { limit: config.limits.poiLimit, radiusMeters: 1500 }) : Promise.resolve([]),
        config.features.elevation ? getRouteElevation({ samples, requestId }) : Promise.resolve({ available: false, reason: 'disabled' }),
        findRoadReportsNearSamples(samples),
        config.features.wildfire ? getRouteWildfire({ samples, requestId }) : Promise.resolve({ available: false, reason: 'disabled' }),
        config.features.traffic ? getRouteTraffic({ samples, requestId }) : Promise.resolve({ available: false, reason: 'disabled' }),
        config.features.traffic ? getRouteTrafficIncidents({ samples, requestId }) : Promise.resolve({ available: false, reason: 'disabled', incidents: [] })
    ]);
    const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : { available: false, reason: 'provider_unavailable' };
    const primaryPois = poisResult.status === 'fulfilled' ? poisResult.value : [];
    const elevation = elevationResult.status === 'fulfilled' ? elevationResult.value : { available: false, reason: 'provider_unavailable' };
    const wildfire = wildfireResult.status === 'fulfilled' ? wildfireResult.value : { available: false, reason: 'provider_unavailable' };
    const traffic = trafficResult.status === 'fulfilled' ? trafficResult.value : { available: false, reason: 'provider_unavailable' };
    const trafficIncidents = trafficIncidentsResult.status === 'fulfilled' ? trafficIncidentsResult.value : { available: false, reason: 'provider_unavailable', incidents: [] };
    const overtureResult = config.features.overture
        ? (await Promise.allSettled([getRouteOverturePois({ samples, existingPois: primaryPois, requestId })]))[0]
        : { status: 'fulfilled', value: { available: false, reason: 'disabled', pois: [] } };
    const overture = overtureResult.status === 'fulfilled' ? overtureResult.value : { available: false, reason: 'provider_unavailable', pois: [] };
    const officialDataResult = config.features.officialData
        ? (await Promise.allSettled([getOfficialRoadAlerts({ samples, requestId })]))[0]
        : { status: 'fulfilled', value: { available: false, reason: 'disabled', alerts: [] } };
    const officialData = officialDataResult.status === 'fulfilled' ? officialDataResult.value : { available: false, reason: 'provider_unavailable', alerts: [] };
    const pois = dedupePois([...primaryPois, ...(overture.pois || [])]);
    const discoveryResult = config.features.discovery
        ? (await Promise.allSettled([getRouteDiscovery({ samples, existingPois: pois, requestId })]))[0]
        : { status: 'fulfilled', value: { available: false, reason: 'disabled' } };
    const discovery = discoveryResult.status === 'fulfilled' ? discoveryResult.value : { available: false, reason: 'provider_unavailable' };
    const roadWarnings = reportsResult.status === 'fulfilled'
        ? reportsResult.value.map((report) => ({ type: 'road_report', category: report.category, description: report.description || undefined, location: { lng: report.location.coordinates[0], lat: report.location.coordinates[1] } }))
        : [];
    const wildfireWarnings = wildfire.status === 'warning'
        ? wildfire.nearbyDetections.map((detection) => ({
            type: 'wildfire_detection',
            category: 'thermal_anomaly',
            description: `Rota koridorunda ${detection.distanceFromRouteKm} km yakında uydu termal anomali tespiti. Yol kapanışı doğrulanmış değildir.`,
            location: { lng: detection.lng, lat: detection.lat }
        }))
        : [];
    const trafficWarnings = traffic.roadClosureCount > 0
        ? [{
            type: 'traffic_road_closure',
            category: 'provider_reported_closure',
            description: `Trafik sağlayıcısı rota örneklerinde ${traffic.roadClosureCount} kapalı yol bölümü bildiriyor. Sürüşten önce güncel durumu teyit edin.`
        }]
        : [];
    const trafficIncidentWarnings = (trafficIncidents.incidents || []).map((incident) => ({ type: 'traffic_incident', category: String(incident.category), description: incident.description, location: incident.location }));
    const warnings = [...roadWarnings, ...wildfireWarnings, ...trafficWarnings, ...trafficIncidentWarnings];
    const curvature = analyzeCurvature(coordinates);
    const poiSummary = Object.fromEntries(poiCategories.map((category) => [category, pois.filter((poi) => poi.category === category).length]));
    const rideScore = calculateRideScore({ weather, traffic, curvature, pois, poiCount: pois.length, warnings: [...roadWarnings, ...trafficWarnings], elevation, wildfire, weights: config.rideScoreWeights });

    return {
        route: { distanceKm: Number((distanceMeters / 1000).toFixed(2)), durationMinutes: durationSeconds ? Math.round(durationSeconds / 60) : null, geometry: { type: 'LineString', coordinates: coordinates.map((point) => [point.lng, point.lat]) }, routingProvider: provider, mode: routePreferences },
        rideScore,
        weather,
        traffic,
        trafficIncidents,
        officialData,
        elevation,
        wildfire,
        discoveries: discovery.places || [],
        poiSummary,
        pois,
        curvature,
        warnings,
        providers: { routing: provider || 'provided_geometry', weather: weather.available === true, poi: config.features.poi, overture: overture.available === true, elevation: elevation.available === true, wildfire: wildfire.available === true, traffic: traffic.available === true, trafficIncidents: trafficIncidents.available === true, officialData: officialData.available === true, discovery: discovery.available === true },
        attribution: [...new Set([
            ...pois.flatMap((poi) => poi.attribution || []),
            ...(elevation.attribution || []),
            ...(traffic.attribution || []),
            ...(trafficIncidents.attribution || []),
            ...(overture.attribution || []),
            ...(wildfire.attribution || []),
            ...(discovery.attribution || [])
        ])]
    };
};
