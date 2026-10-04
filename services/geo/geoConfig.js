const toBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const toNumber = (value, fallback, { min, max } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (min !== undefined && parsed < min) return min;
    if (max !== undefined && parsed > max) return max;
    return parsed;
};

const defaultRideScoreWeights = Object.freeze({ weather: 0.20, traffic: 0.15, curves: 0.15, scenery: 0.20, poi: 0.10, elevation: 0.05, safety: 0.15 });

const rideScoreWeights = (value) => {
    try {
        const parsed = JSON.parse(value || '');
        const weights = Object.fromEntries(Object.keys(defaultRideScoreWeights).map((key) => {
            const weight = Number(parsed?.[key]);
            return [key, Number.isFinite(weight) && weight >= 0 ? weight : defaultRideScoreWeights[key]];
        }));
        return Object.values(weights).some((weight) => weight > 0) ? weights : defaultRideScoreWeights;
    } catch (_) {
        return defaultRideScoreWeights;
    }
};

export const geoConfig = () => ({
    routingProvider: (process.env.ROUTING_PROVIDER || 'mapbox').trim().toLowerCase(),
    rideScoreWeights: rideScoreWeights(process.env.GEO_RIDE_SCORE_WEIGHTS),
    features: {
        weather: toBoolean(process.env.GEO_WEATHER_ENABLED, true),
        poi: toBoolean(process.env.GEO_POI_ENABLED, true),
        elevation: toBoolean(process.env.GEO_ELEVATION_ENABLED, true),
        wildfire: toBoolean(process.env.GEO_WILDFIRE_ENABLED, false),
        traffic: toBoolean(process.env.GEO_TRAFFIC_ENABLED, false),
        overture: toBoolean(process.env.GEO_OVERTURE_ENABLED, false),
        officialData: toBoolean(process.env.GEO_OFFICIAL_DATA_ENABLED, false),
        discovery: toBoolean(process.env.GEO_DISCOVERY_ENABLED, false)
    },
    limits: {
        nearbyRadiusMeters: toNumber(process.env.GEO_MAX_NEARBY_RADIUS_METERS, 50000, { min: 100, max: 100000 }),
        poiLimit: toNumber(process.env.GEO_MAX_POI_RESULTS, 100, { min: 1, max: 250 }),
        routeDistanceKm: toNumber(process.env.GEO_MAX_ROUTE_DISTANCE_KM, 750, { min: 1, max: 1500 }),
        sampleSpacingKm: toNumber(process.env.GEO_SAMPLE_SPACING_KM, 20, { min: 5, max: 50 }),
        roadReportTtlHours: toNumber(process.env.GEO_ROAD_REPORT_MAX_TTL_HOURS, 168, { min: 1, max: 720 }),
        wildfireDays: toNumber(process.env.GEO_WILDFIRE_DAYS, 1, { min: 1, max: 5 }),
        wildfireRouteCorridorKm: toNumber(process.env.GEO_WILDFIRE_ROUTE_CORRIDOR_KM, 20, { min: 1, max: 100 }),
        trafficSampleCount: toNumber(process.env.GEO_TRAFFIC_SAMPLE_COUNT, 5, { min: 1, max: 8 }),
        providerCircuitFailureThreshold: toNumber(process.env.GEO_PROVIDER_CIRCUIT_FAILURE_THRESHOLD, 3, { min: 2, max: 10 }),
        providerCircuitCooldownSeconds: toNumber(process.env.GEO_PROVIDER_CIRCUIT_COOLDOWN_SECONDS, 60, { min: 10, max: 900 }),
        discoverySampleCount: toNumber(process.env.GEO_DISCOVERY_SAMPLE_COUNT, 3, { min: 1, max: 5 }),
        discoveryRadiusMeters: toNumber(process.env.GEO_DISCOVERY_RADIUS_METERS, 10000, { min: 100, max: 10000 }),
        discoveryLimit: toNumber(process.env.GEO_DISCOVERY_LIMIT, 18, { min: 1, max: 40 })
    },
    providers: {
        openRouteServiceUrl: (process.env.OPENROUTESERVICE_BASE_URL || 'https://api.openrouteservice.org').replace(/\/$/, ''),
        valhallaUrl: (process.env.VALHALLA_BASE_URL || '').replace(/\/$/, ''),
        openMeteoUrl: (process.env.OPENMETEO_BASE_URL || 'https://api.open-meteo.com/v1').replace(/\/$/, ''),
        openMeteoElevationUrl: (process.env.OPENMETEO_ELEVATION_BASE_URL || process.env.OPENMETEO_BASE_URL || 'https://api.open-meteo.com/v1').replace(/\/$/, ''),
        overpassUrl: (process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter').trim(),
        firmsUrl: (process.env.NASA_FIRMS_BASE_URL || 'https://firms.modaps.eosdis.nasa.gov/api').replace(/\/$/, ''),
        firmsSource: (process.env.NASA_FIRMS_SOURCE || 'VIIRS_SNPP_NRT').trim(),
        tomTomUrl: (process.env.TOMTOM_TRAFFIC_BASE_URL || 'https://api.tomtom.com').replace(/\/$/, ''),
        overtureUrl: (process.env.OVERTURE_API_URL || '').replace(/\/$/, ''),
        wikidataUrl: (process.env.WIKIDATA_API_URL || 'https://www.wikidata.org/w/api.php').trim()
    }
});

export const isGeoFeatureEnabled = (name) => Boolean(geoConfig().features[name]);
