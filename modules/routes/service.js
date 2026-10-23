import { getMapboxDirectionsAccessToken } from "../../config/env.js";
import AppError from "../../utils/appError.js";

const MAPBOX_OPTIMIZATION_URL =
    'https://api.mapbox.com/optimized-trips/v1/mapbox/driving';
const MIN_DISTANCE_KM = 5;
const MAX_DISTANCE_KM = 100;
const DEFAULT_DISTANCE_KM = 10;
const REQUEST_TIMEOUT_MS = 12000;
const MIN_ANCHOR_DISTANCE_KM = 0.25;
const MAX_ANCHOR_DISTANCE_KM = 18;
const CALIBRATION_DEVIATION_RATIO = 0.25;
const MIN_CALIBRATION_SCALE = 0.2;
const MAX_CALIBRATION_SCALE = 2.5;
const MAX_VARIANT = 50;

const supportedIntensities = new Set(['Low', 'Medium', 'High']);

const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeText = (value, maxLength) =>
    typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const degreesToRadians = (value) => value * Math.PI / 180;
const radiansToDegrees = (value) => value * 180 / Math.PI;

const destinationPoint = ({ lat, lng }, bearingDegrees, distanceKm) => {
    const earthRadiusKm = 6371.0088;
    const angularDistance = distanceKm / earthRadiusKm;
    const bearing = degreesToRadians(bearingDegrees);
    const startLat = degreesToRadians(lat);
    const startLng = degreesToRadians(lng);

    const targetLat = Math.asin(
        Math.sin(startLat) * Math.cos(angularDistance) +
        Math.cos(startLat) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const targetLng = startLng + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(startLat),
        Math.cos(angularDistance) - Math.sin(startLat) * Math.sin(targetLat)
    );

    return {
        lat: radiansToDegrees(targetLat),
        lng: ((radiansToDegrees(targetLng) + 540) % 360) - 180
    };
};

const stableHash = (value) => {
    let hash = 2166136261;
    for (const character of value) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

export const normalizeApexRouteRequest = (body = {}) => {
    const lat = toFiniteNumber(body?.lat);
    const lng = toFiniteNumber(body?.lng);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new AppError('Gecerli bir baslangic konumu (lat, lng) gereklidir.', 400);
    }

    const preferences = body?.preferences && typeof body.preferences === 'object'
        ? body.preferences
        : {};
    const distance = preferences.distance ?? DEFAULT_DISTANCE_KM;
    const requestedDistanceKm = toFiniteNumber(distance);
    if (
        requestedDistanceKm === null ||
        requestedDistanceKm < MIN_DISTANCE_KM ||
        requestedDistanceKm > MAX_DISTANCE_KM
    ) {
        throw new AppError(
            `Hedef mesafe ${MIN_DISTANCE_KM}-${MAX_DISTANCE_KM} km arasinda olmalidir.`,
            422
        );
    }

    const intensity = normalizeText(body?.intensity, 16) || 'Medium';
    if (!supportedIntensities.has(intensity)) {
        throw new AppError('Gecerli bir rota yogunlugu secmelisiniz.', 422);
    }

    const prompt = normalizeText(body?.prompt, 120);
    const environment = normalizeText(preferences.environment, 48) || 'Kesif';
    // "Another suggestion": an optional counter that turns the loop elsewhere.
    const variant = Math.trunc(toFiniteNumber(preferences.variant) ?? 0);

    return {
        start: { lat, lng },
        requestedDistanceKm,
        intensity,
        prompt,
        environment,
        variant: Math.max(0, Math.min(MAX_VARIANT, variant))
    };
};

// Generic loops step around the compass by the golden angle; terrain-led
// loops (coast, pass) swing to either side of the terrain heading instead of
// leaving it: +35, -35, +70, -70, +105, -105, then again.
export const variantBearing = (bearing, variant = 0, terrainLed = false) => {
    if (!variant) return bearing;
    const swing = terrainLed
        ? (variant % 2 === 1 ? 1 : -1) * 35 * (((Math.ceil(variant / 2) - 1) % 3) + 1)
        : variant * 137.508;
    return ((bearing + swing) % 360 + 360) % 360;
};

export const resolveEnvironmentBearing = async (request, { fetchImpl = globalThis.fetch } = {}) => {
    const isCoastal = /sahil|kıyı|deniz|coast/i.test(request.environment) || /sahil|kıyı|deniz|coast/i.test(request.prompt);
    const isMountain = /dağ|geçit|tepe|tırmanış|mountain/i.test(request.environment) || /dağ|geçit|tepe|tırmanış|mountain/i.test(request.prompt);

    const fallbackBearing = stableHash(
        `${request.start.lat.toFixed(4)}:${request.start.lng.toFixed(4)}:${request.environment}:${request.prompt}`
    ) % 360;

    if (!isCoastal && !isMountain) {
        return fallbackBearing;
    }

    try {
        const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
        const sampleDist = Math.max(1.5, Math.min(12, request.requestedDistanceKm * 0.35));
        const samples = bearings.map((b) => destinationPoint(request.start, b, sampleDist));
        const lats = samples.map((p) => p.lat.toFixed(4)).join(',');
        const lngs = samples.map((p) => p.lng.toFixed(4)).join(',');
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

        const res = await fetchImpl(url, { signal: AbortSignal.timeout(2000) });
        const data = await res.json().catch(() => ({}));
        const elevations = data?.elevation;

        if (Array.isArray(elevations) && elevations.length === 8) {
            if (isMountain) {
                let maxElev = -Infinity;
                let bestBearing = fallbackBearing;
                elevations.forEach((el, i) => {
                    const num = Number(el);
                    if (Number.isFinite(num) && num > maxElev) {
                        maxElev = num;
                        bestBearing = bearings[i];
                    }
                });
                return bestBearing;
            }

            if (isCoastal) {
                let waterBearing = null;
                for (let i = 0; i < 8; i += 1) {
                    const num = Number(elevations[i]);
                    if (Number.isFinite(num) && num <= 0) {
                        waterBearing = bearings[i];
                        break;
                    }
                }
                if (waterBearing !== null) {
                    return (waterBearing + 90) % 360;
                }
                let minElev = Infinity;
                let valleyBearing = fallbackBearing;
                elevations.forEach((el, i) => {
                    const num = Number(el);
                    if (Number.isFinite(num) && num < minElev) {
                        minElev = num;
                        valleyBearing = bearings[i];
                    }
                });
                return valleyBearing;
            }
        }
    } catch {
        // Graceful fallback to deterministic bearing
    }

    return fallbackBearing;
};

export const buildApexAnchorPoints = (request, anchorScale = 1, customBearing = null) => {
    const routeFactor = request.intensity === 'High'
        ? 4.6
        : request.intensity === 'Low'
            ? 3.8
            : 4.2;
    const baseAnchorDistanceKm = Math.max(
        MIN_ANCHOR_DISTANCE_KM,
        Math.min(MAX_ANCHOR_DISTANCE_KM, request.requestedDistanceKm / routeFactor)
    );
    const normalizedAnchorScale = Math.max(
        MIN_CALIBRATION_SCALE,
        Math.min(
            MAX_CALIBRATION_SCALE,
            Number.isFinite(anchorScale) ? anchorScale : 1
        )
    );
    const anchorDistanceKm = Math.max(
        MIN_ANCHOR_DISTANCE_KM,
        Math.min(MAX_ANCHOR_DISTANCE_KM, baseAnchorDistanceKm * normalizedAnchorScale)
    );
    const bearing = Number.isFinite(customBearing)
        ? (customBearing % 360 + 360) % 360
        : (stableHash(
            `${request.start.lat.toFixed(4)}:${request.start.lng.toFixed(4)}:${request.environment}:${request.prompt}`
        ) % 360);

    const isMountain = /dağ|geçit|tepe|tırmanış|mountain/i.test(request.environment) || /dağ|geçit|tepe|tırmanış|mountain/i.test(request.prompt);
    const isCoastal = /sahil|kıyı|deniz|coast/i.test(request.environment) || /sahil|kıyı|deniz|coast/i.test(request.prompt);

    let offsets;
    if (isMountain) {
        offsets = request.intensity === 'High'
            ? [-25, 25, -50, 50]
            : [0, -35, 35];
    } else if (isCoastal) {
        offsets = request.intensity === 'High'
            ? [15, 45, 135, 180]
            : [15, 60, 165];
    } else {
        offsets = request.intensity === 'High'
            ? [24, 126, 220, 308]
            : request.intensity === 'Low'
                ? [36, 156, 274]
                : [18, 132, 246];
    }

    return [
        request.start,
        ...offsets.map((offset, index) => destinationPoint(
            request.start,
            bearing + offset,
            anchorDistanceKm * (index % 2 == 0 ? 1 : 0.88)
        ))
    ];
};

const parseRoadGeometry = (payload) => {
    const trip = payload?.trips?.[0];
    const rawCoordinates = trip?.geometry?.coordinates;
    if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
        throw new AppError('Yol agi bu konum icin gecerli bir rota uretemedi.', 422);
    }

    const coordinates = rawCoordinates.map((point) => {
        const lng = toFiniteNumber(point?.[0]);
        const lat = toFiniteNumber(point?.[1]);
        if (lng === null || lat === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new AppError('Yol agindan gecersiz rota geometrisi alindi.', 502);
        }
        return [lng, lat];
    });

    const distanceMeters = toFiniteNumber(trip?.distance);
    const durationSeconds = toFiniteNumber(trip?.duration);
    if (distanceMeters === null || distanceMeters <= 0 || durationSeconds === null || durationSeconds < 0) {
        throw new AppError('Yol agi rota metriklerini donduremedi.', 502);
    }

    return { coordinates, distanceMeters, durationSeconds };
};

const formatDistance = (distanceMeters) => {
    const distanceKm = distanceMeters / 1000;
    return distanceKm < 10
        ? `${distanceKm.toFixed(1)} km`
        : `${Math.round(distanceKm)} km`;
};

const formatDuration = (durationSeconds) =>
    `${Math.max(1, Math.round(durationSeconds / 60))} dk`;

const requestRoadGeometry = async ({ anchors, accessToken, fetchImpl }) => {
    const coordinatePath = anchors
        .map(({ lng, lat }) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
        .join(';');
    const endpoint = new URL(`${MAPBOX_OPTIMIZATION_URL}/${coordinatePath}`);
    endpoint.search = new URLSearchParams({
        access_token: accessToken,
        source: 'first',
        roundtrip: 'true',
        overview: 'full',
        geometries: 'geojson',
        steps: 'false',
        radiuses: anchors.map(() => 'unlimited').join(';')
    }).toString();

    let response;
    try {
        response = await fetchImpl(endpoint, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            throw new AppError('Apex rota planlayicisi zaman asimina ugradi.', 504);
        }
        throw new AppError('Apex rota planlayicisina baglanilamadi.', 503);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new AppError('Apex rota planlayicisi su anda yapilandirilmamis.', 503);
        }
        if (response.status === 429) {
            throw new AppError('Rota planlayicisi yogun. Lutfen biraz sonra tekrar deneyin.', 503);
        }
        throw new AppError('Apex rota planlayicisi rota uretemedi.', 502);
    }
    if (payload?.code !== 'Ok') {
        throw new AppError('Yol agi bu konum icin gecerli bir rota uretemedi.', 422);
    }

    return parseRoadGeometry(payload);
};

export const generateApexRoutePreview = async (
    body,
    {
        accessToken = getMapboxDirectionsAccessToken(),
        fetchImpl = globalThis.fetch,
        elevationFetcher = globalThis.fetch
    } = {}
) => {
    const request = normalizeApexRouteRequest(body);
    if (!accessToken) {
        throw new AppError(
            'Apex rota planlayicisi su anda yapilandirilmamis.',
            503
        );
    }
    if (typeof fetchImpl !== 'function') {
        throw new AppError('Apex rota planlayicisi kullanilamiyor.', 503);
    }

    const targetDistanceMeters = request.requestedDistanceKm * 1000;
    const terrainLed = /sahil|kıyı|deniz|coast|dağ|geçit|tepe|tırmanış|mountain/i
        .test(`${request.environment} ${request.prompt}`);
    const resolvedBearing = variantBearing(
        await resolveEnvironmentBearing(request, { fetchImpl: elevationFetcher }),
        request.variant,
        terrainLed
    );
    let roadRoute = await requestRoadGeometry({
        anchors: buildApexAnchorPoints(request, 1, resolvedBearing),
        accessToken,
        fetchImpl
    });
    const initialDeviation = Math.abs(roadRoute.distanceMeters - targetDistanceMeters);

    if (initialDeviation > targetDistanceMeters * CALIBRATION_DEVIATION_RATIO) {
        const calibrationScale = Math.max(
            MIN_CALIBRATION_SCALE,
            Math.min(
                MAX_CALIBRATION_SCALE,
                targetDistanceMeters / roadRoute.distanceMeters
            )
        );

        try {
            const calibratedRoute = await requestRoadGeometry({
                anchors: buildApexAnchorPoints(request, calibrationScale, resolvedBearing),
                accessToken,
                fetchImpl
            });
            const calibratedDeviation = Math.abs(
                calibratedRoute.distanceMeters - targetDistanceMeters
            );
            if (calibratedDeviation < initialDeviation) {
                roadRoute = calibratedRoute;
            }
        } catch (error) {
            // A valid road route already exists; never replace it with a failed optional retry.
            console.warn(
                '[ApexRoutePlanner] Optional distance calibration failed; returning the initial road route.',
                { statusCode: error?.statusCode ?? 500 }
            );
        }
    }

    const { coordinates, distanceMeters, durationSeconds } = roadRoute;
    const isMountain = /dağ|geçit|tepe|tırmanış|mountain/i.test(request.environment) || /dağ|geçit|tepe|tırmanış|mountain/i.test(request.prompt);
    const isCoastal = /sahil|kıyı|deniz|coast/i.test(request.environment) || /sahil|kıyı|deniz|coast/i.test(request.prompt);
    const isNight = /gece|night|aydınlatma/i.test(request.environment) || /gece|night|aydınlatma/i.test(request.prompt);

    const title = request.prompt || `Apex ${request.environment} Rotası`;
    const description = request.prompt
        ? `${request.prompt} kapsamında optimize edilmiş Apex rota geometrisi.`
        : isCoastal
            ? 'Kıyı şeridi ve sahil hattı boyunca optimize edilmiş rota önizlemesi.'
            : isMountain
                ? 'Dağ etabı ve teknik virajlar boyunca optimize edilmiş rota önizlemesi.'
                : isNight
                    ? 'Gece sürüşü için aydınlatmalı ana arterlerde optimize edilmiş rota önizlemesi.'
                    : `${request.environment} temalı optimize edilmiş Apex rota önizlemesi.`;

    const envTag = isCoastal ? 'Sahil Hattı' : isMountain ? 'Dağ Etabı' : isNight ? 'Gece Sürüşü' : request.environment;

    return {
        title,
        description,
        difficulty: request.intensity === 'High'
            ? 'Zor'
            : request.intensity === 'Low'
                ? 'Kolay'
                : 'Orta',
        distance: formatDistance(distanceMeters),
        estimatedTime: formatDuration(durationSeconds),
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: Math.round(durationSeconds),
        requestedDistanceKm: request.requestedDistanceKm,
        coordinates: coordinates.map(([lng, lat]) => ({ lat, lng })),
        path: { type: 'LineString', coordinates },
        tags: ['PRO', 'Apex AI', envTag, request.intensity],
        variant: request.variant,
        isAIGenerated: true,
        isDraft: true
    };
};
