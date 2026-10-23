import assert from 'node:assert/strict';
import test from 'node:test';
import {
    generateApexRoutePreview,
    normalizeApexRouteRequest
} from "../modules/routes/service.js";

const roadNetworkResponse = {
    code: 'Ok',
    trips: [{
        distance: 12432.8,
        duration: 1488.2,
        geometry: {
            type: 'LineString',
            coordinates: [
                [28.9784, 41.0082],
                [28.984, 41.01],
                [28.991, 41.012]
            ]
        }
    }]
};

test('Apex preview accepts zero latitude or longitude when it is valid', () => {
    const request = normalizeApexRouteRequest({
        lat: 0,
        lng: 0,
        preferences: { distance: 10 },
        intensity: 'Medium'
    });
    assert.deepEqual(request.start, { lat: 0, lng: 0 });
});

test('Apex preview returns Mapbox road geometry without persisting a Route', async () => {
    const preview = await generateApexRoutePreview(
        {
            lat: 41.0082,
            lng: 28.9784,
            preferences: { distance: 10, environment: 'Sahil' },
            intensity: 'Medium'
        },
        {
            accessToken: 'test-token',
            fetchImpl: async () => new Response(JSON.stringify(roadNetworkResponse), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }
    );

    assert.equal(preview.isDraft, true);
    assert.equal(preview.distanceMeters, 12433);
    assert.equal(preview.durationSeconds, 1488);
    assert.deepEqual(preview.coordinates[0], { lat: 41.0082, lng: 28.9784 });
    assert.deepEqual(preview.path.coordinates[2], [28.991, 41.012]);
});

test('Apex preview recalibrates a large road-distance deviation once', async () => {
    let calls = 0;
    const preview = await generateApexRoutePreview(
        {
            lat: 41.0082,
            lng: 28.9784,
            preferences: { distance: 10, environment: 'Sahil' },
            intensity: 'Medium'
        },
        {
            accessToken: 'test-token',
            fetchImpl: async () => {
                calls += 1;
                const calibrated = calls === 2;
                return new Response(JSON.stringify({
                    code: 'Ok',
                    trips: [{
                        distance: calibrated ? 10200 : 31400,
                        duration: calibrated ? 1260 : 3900,
                        geometry: {
                            type: 'LineString',
                            coordinates: calibrated
                                ? [[28.9784, 41.0082], [28.984, 41.01]]
                                : [[28.9784, 41.0082], [29.04, 41.06]]
                        }
                    }]
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
        }
    );

    assert.equal(calls, 2);
    assert.equal(preview.distanceMeters, 10200);
    assert.equal(preview.distance, '10 km');
    assert.equal(preview.durationSeconds, 1260);
});

test('Apex preview avoids a second Mapbox request within the distance tolerance', async () => {
    let calls = 0;
    const preview = await generateApexRoutePreview(
        {
            lat: 41.0082,
            lng: 28.9784,
            preferences: { distance: 10, environment: 'Sahil' },
            intensity: 'Medium'
        },
        {
            accessToken: 'test-token',
            fetchImpl: async () => {
                calls += 1;
                return new Response(JSON.stringify({
                    code: 'Ok',
                    trips: [{
                        distance: 11800,
                        duration: 1440,
                        geometry: {
                            type: 'LineString',
                            coordinates: [[28.9784, 41.0082], [28.984, 41.01]]
                        }
                    }]
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
        }
    );

    assert.equal(calls, 1);
    assert.equal(preview.distanceMeters, 11800);
});

test('Apex preview refuses to invent a route when no routing token exists', async () => {
    await assert.rejects(
        () => generateApexRoutePreview(
            { lat: 41.0082, lng: 28.9784 },
            { accessToken: '', fetchImpl: async () => { throw new Error('not called'); } }
        ),
        (error) => error.statusCode === 503
    );
});

test('Apex entitlement expires even when the legacy premium flag remains true', async () => {
    const { hasActiveApexAccess } = await import('../utils/apexAccess.js');
    assert.equal(
        hasActiveApexAccess(
            { isPremium: true, proExpiryDate: '2020-01-01T00:00:00.000Z' },
            new Date('2026-07-20T00:00:00.000Z')
        ),
        false
    );
});

test('Apex environment bearing resolves mountain highest peak and coastal water tangent', async () => {
    const { resolveEnvironmentBearing } = await import("../modules/routes/service.js");

    // Mock elevation returning peak at bearing 0 (120m) and water at bearing 90 (0m)
    const mockFetch = async () => new Response(JSON.stringify({
        elevation: [120, 45, 0, 10, 30, 20, 50, 80] // bearings [0, 45, 90, 135, 180, 225, 270, 315]
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const mountainBearing = await resolveEnvironmentBearing({
        start: { lat: 41.0082, lng: 28.9784 },
        requestedDistanceKm: 15,
        environment: 'Dağ Geçidi',
        prompt: ''
    }, { fetchImpl: mockFetch });

    assert.equal(mountainBearing, 0); // bearing 0 has max elevation 120m

    const coastalBearing = await resolveEnvironmentBearing({
        start: { lat: 41.0082, lng: 28.9784 },
        requestedDistanceKm: 15,
        environment: 'Sahil',
        prompt: ''
    }, { fetchImpl: mockFetch });

    assert.equal(coastalBearing, 180); // water at bearing 90 -> tangent is 90 + 90 = 180
});

test('Apex variant turns the loop: around the compass, or beside the terrain heading', async () => {
    const { variantBearing } = await import('../modules/routes/service.js');
    assert.equal(variantBearing(90, 0, false), 90);
    assert.equal(variantBearing(90, 0, true), 90);
    // Terrain-led loops stay within 105 degrees of the terrain heading.
    const swings = [1, 2, 3, 4, 5, 6, 7].map((v) => variantBearing(90, v, true));
    assert.deepEqual(swings, [125, 55, 160, 20, 195, 345, 125]);
    // Generic loops spread out; consecutive suggestions never repeat a heading.
    const generic = [0, 1, 2, 3].map((v) => Math.round(variantBearing(10, v, false)));
    assert.equal(new Set(generic).size, 4);

    const request = normalizeApexRouteRequest({
        lat: 41, lng: 29, preferences: { distance: 10, variant: '3' }
    });
    assert.equal(request.variant, 3);
    assert.equal(normalizeApexRouteRequest({
        lat: 41, lng: 29, preferences: { distance: 10, variant: 999 }
    }).variant, 50);
    assert.equal(normalizeApexRouteRequest({
        lat: 41, lng: 29, preferences: { distance: 10 }
    }).variant, 0);
});

test('Apex variant reaches the road planner as different anchors', async () => {
    const anchorsFor = async (variant) => {
        let url = '';
        await generateApexRoutePreview(
            { lat: 41.0082, lng: 28.9784, preferences: { distance: 10, environment: 'Şehir İçi', variant } },
            {
                accessToken: 'test-token',
                fetchImpl: async (endpoint) => {
                    url = String(endpoint);
                    return new Response(JSON.stringify(roadNetworkResponse), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    });
                }
            }
        );
        return url.split('/driving/')[1].split('?')[0];
    };
    const first = await anchorsFor(0);
    assert.equal(await anchorsFor(0), first);
    assert.notEqual(await anchorsFor(1), first);
});
