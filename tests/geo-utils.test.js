import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCurvature, routeDistanceMeters, sampleRoute } from "../modules/geo/utils/geoMath.js";
import { calculateRideScore, calculateScenicScore } from "../modules/geo/service.js";
import { normalizeRoutePreferences } from "../modules/geo/routeModePolicy.js";
import { summarizeElevation } from "../modules/geo/providers/openMeteoElevationProvider.js";
import { summarizeRouteWeather } from "../modules/geo/providers/openMeteoProvider.js";
import { parseFirmsCsv, summarizeWildfireDetections } from "../modules/geo/providers/nasaFirmsProvider.js";
import { normalizeWikidataDiscovery } from "../modules/geo/providers/wikidataDiscoveryProvider.js";
import { summarizeTrafficSegments } from "../modules/geo/providers/tomTomTrafficProvider.js";
import { normalizeOverturePois } from "../modules/geo/providers/overtureProvider.js";
import { createBboxTiles, resolvePoiImportBounds } from "../modules/geo/poiImportPlanner.js";
import { assertProviderAvailable, getGeoProviderMetrics, recordProviderResult, resetGeoProviderMetricsForTest } from "../modules/geo/geoProviderMonitor.js";
import { normalizeTomTomIncidents } from "../modules/geo/providers/tomTomIncidentsProvider.js";
import { resolveRoadReportExpiry } from "../modules/geo/roadReportPolicy.js";

const route = [
    { lat: 41.0082, lng: 28.9784 },
    { lat: 41.0098, lng: 28.9950 },
    { lat: 41.0030, lng: 29.0100 },
    { lat: 41.0120, lng: 29.0250 }
];

test('route sampling keeps both endpoints without sampling every coordinate', () => {
    const samples = sampleRoute(route, 5);
    assert.deepEqual(samples[0], route[0]);
    assert.deepEqual(samples.at(-1), route.at(-1));
    assert.ok(routeDistanceMeters(route) > 0);
});

test('curvature is normalized and ride score degrades for warnings', () => {
    const curvature = analyzeCurvature(route);
    assert.ok(curvature.curveScore >= 0 && curvature.curveScore <= 100);
    const safe = calculateRideScore({ weather: { available: true, precipitation: 0, windGusts: 10 }, curvature, poiCount: 8, warnings: [] });
    const warned = calculateRideScore({ weather: { available: true, precipitation: 0, windGusts: 10 }, curvature, poiCount: 8, warnings: [{ type: 'road_report' }] });
    assert.ok(safe.overall >= warned.overall);
    assert.equal(warned.safety, 82);
});

test('scenic score uses natural POIs and elevation without treating curves as safety', () => {
    const low = calculateScenicScore({ pois: [], elevation: { available: true, min: 10, max: 20 } });
    const high = calculateScenicScore({
        pois: [{ category: 'viewpoint' }, { category: 'water' }, { category: 'tourism' }],
        elevation: { available: true, min: 10, max: 700 }
    });
    assert.ok(high > low);
    assert.equal(normalizeRoutePreferences({ mode: 'scenic', avoidHighways: true }).mode, 'scenic');
    assert.equal(normalizeRoutePreferences({ mode: 'unknown' }).mode, 'fastest');
});

test('elevation summary keeps a compact profile and calculates ascent/descent', () => {
    const elevation = summarizeElevation({
        samples: route,
        elevations: [24, 85, 62, 130]
    });
    assert.equal(elevation.available, true);
    assert.equal(elevation.min, 24);
    assert.equal(elevation.max, 130);
    assert.equal(elevation.ascent, 129);
    assert.equal(elevation.descent, 23);
    assert.equal(elevation.profile.length, route.length);
});

test('weather summary keeps visibility, rain probability and a bounded hourly outlook', () => {
    const weather = summarizeRouteWeather([{
        current: {
            time: '2026-08-17T10:00', temperature_2m: 24, apparent_temperature: 23,
            precipitation: 0, precipitation_probability: 15, wind_speed_10m: 12,
            wind_gusts_10m: 20, visibility: 10000, weather_code: 1
        },
        hourly: {
            time: ['2026-08-17T10:00', '2026-08-17T11:00', '2026-08-17T12:00'],
            temperature_2m: [24, 25, 26], apparent_temperature: [23, 24, 25],
            precipitation: [0, 0.1, 0.5], precipitation_probability: [15, 30, 65],
            wind_speed_10m: [12, 14, 18], wind_gusts_10m: [20, 22, 30],
            visibility: [10000, 8500, 6000], weather_code: [1, 2, 61]
        }
    }]);
    assert.equal(weather.precipitationProbability, 15);
    assert.equal(weather.visibilityMeters, 10000);
    assert.equal(weather.hourly.length, 3);
    assert.equal(weather.hourly[2].precipitationProbability, 65);
});

test('road report expiry stays within the configured retention window', () => {
    const now = new Date('2026-08-14T10:00:00.000Z');
    const expiry = resolveRoadReportExpiry({ category: 'construction', ttlHours: 900, now, maxTtlHours: 168 });
    assert.equal(expiry.toISOString(), '2026-08-21T10:00:00.000Z');
    assert.equal(resolveRoadReportExpiry({ category: 'hazard', expiresAt: '2026-08-14T09:00:00.000Z', now }), null);
});

test('FIRMS CSV parsing keeps valid thermal detections and route-corridor distance', () => {
    const detections = parseFirmsCsv([
        'latitude,longitude,confidence,frp,acq_date,acq_time,daynight',
        '41.009,28.979,h,12.5,2026-08-14,1015,D',
        'not-a-number,28.979,h,4,2026-08-14,1015,D'
    ].join('\n'));
    assert.equal(detections.length, 1);
    const summary = summarizeWildfireDetections({ detections, samples: route, routeCorridorKm: 2 });
    assert.equal(summary.nearbyDetections.length, 1);
    assert.ok(summary.nearestDetectionDistanceKm < 2);
});

test('Wikidata discovery removes POIs already represented by the primary dataset', () => {
    const places = normalizeWikidataDiscovery({
        pages: [{ title: 'Q1', lat: 41.0082, lon: 28.9784, dist: 12 }],
        entities: { Q1: { id: 'Q1', labels: { tr: { value: 'Yakın durak' } }, descriptions: { tr: { value: 'Test keşif noktası' } } } },
        existingPois: [{ name: 'Yakın durak', location: { lat: 41.0082, lng: 28.9784 } }]
    });
    assert.equal(places.length, 0);
});

test('traffic summary is optional and preserves provider-reported closures', () => {
    const traffic = summarizeTrafficSegments([
        { currentSpeed: 30, freeFlowSpeed: 60, confidence: 0.8, roadClosure: false },
        { currentSpeed: 20, freeFlowSpeed: 40, confidence: 0.6, roadClosure: true }
    ]);
    assert.equal(traffic.available, true);
    assert.equal(traffic.congestionPercent, 50);
    assert.equal(traffic.roadClosureCount, 1);
    assert.equal(traffic.status, 'closure_reported');
    assert.equal(summarizeTrafficSegments([]).available, false);
});

test('Overture normalization keeps valid source data and removes primary POI duplicates', () => {
    const pois = normalizeOverturePois({
        pois: [{ id: 'place-1', name: 'Mola noktası', category: 'cafe', lat: 41.0082, lng: 28.9784 }],
        existingPois: [{ name: 'Mola noktası', location: { lat: 41.0082, lng: 28.9784 } }]
    });
    assert.equal(pois.length, 0);
});

test('POI importer turns the Turkey envelope into bounded Overpass tiles', () => {
    const bounds = resolvePoiImportBounds({ country: 'tr' });
    const tiles = createBboxTiles(bounds, 1);
    assert.deepEqual(tiles[0], [35.8, 25.6, 36.8, 26.6]);
    assert.ok(tiles.length > 1);
    assert.throws(() => resolvePoiImportBounds({ country: 'XX' }));
});

test('provider monitor opens a short circuit only after retryable failures', () => {
    resetGeoProviderMetricsForTest();
    for (let index = 0; index < 3; index += 1) {
        recordProviderResult({ provider: 'test_provider', success: false, statusCode: 503, retryable: true });
    }
    assert.equal(getGeoProviderMetrics().test_provider.circuit, 'open');
    assert.throws(() => assertProviderAvailable('test_provider'));
    resetGeoProviderMetricsForTest();
});

test('TomTom incident normalization retains a safe map location and Turkish event text', () => {
    const incidents = normalizeTomTomIncidents([{ properties: { id: 'event-1', iconCategory: 9, delay: 120, events: [{ description: 'Yol çalışması' }] }, geometry: { type: 'Point', coordinates: [28.9784, 41.0082] } }]);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].description, 'Yol çalışması');
    assert.equal(incidents[0].location.lat, 41.0082);
});
