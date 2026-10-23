const earthRadiusMeters = 6371008.8;

export const isValidCoordinate = (point) => Number.isFinite(point?.lat) &&
    Number.isFinite(point?.lng) &&
    point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;

export const haversineMeters = (a, b) => {
    if (!isValidCoordinate(a) || !isValidCoordinate(b)) return NaN;
    const radians = Math.PI / 180;
    const dLat = (b.lat - a.lat) * radians;
    const dLng = (b.lng - a.lng) * radians;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(x)));
};

export const routeDistanceMeters = (coordinates) => coordinates.slice(1)
    .reduce((total, point, index) => total + (haversineMeters(coordinates[index], point) || 0), 0);

export const sampleRoute = (coordinates, spacingKm = 20) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const intervalMeters = Math.max(5000, spacingKm * 1000);
    const samples = [coordinates[0]];
    let carriedMeters = 0;

    for (let index = 1; index < coordinates.length; index += 1) {
        carriedMeters += haversineMeters(coordinates[index - 1], coordinates[index]) || 0;
        if (carriedMeters >= intervalMeters) {
            samples.push(coordinates[index]);
            carriedMeters = 0;
        }
    }
    const last = coordinates[coordinates.length - 1];
    if (samples[samples.length - 1] !== last) samples.push(last);
    return samples;
};

const bearing = (from, to) => {
    const radians = Math.PI / 180;
    const y = Math.sin((to.lng - from.lng) * radians) * Math.cos(to.lat * radians);
    const x = Math.cos(from.lat * radians) * Math.sin(to.lat * radians) -
        Math.sin(from.lat * radians) * Math.cos(to.lat * radians) * Math.cos((to.lng - from.lng) * radians);
    return (Math.atan2(y, x) / radians + 360) % 360;
};

const bearingDelta = (first, second) => Math.abs(((second - first + 540) % 360) - 180);

export const analyzeCurvature = (coordinates) => {
    if (!Array.isArray(coordinates) || coordinates.length < 3) return { curveScore: 0, curvesPerKm: 0 };
    let meaningfulTurns = 0;
    for (let index = 2; index < coordinates.length; index += 1) {
        const firstDistance = haversineMeters(coordinates[index - 2], coordinates[index - 1]);
        const secondDistance = haversineMeters(coordinates[index - 1], coordinates[index]);
        if (firstDistance < 12 || secondDistance < 12) continue;
        if (bearingDelta(bearing(coordinates[index - 2], coordinates[index - 1]), bearing(coordinates[index - 1], coordinates[index])) >= 12) meaningfulTurns += 1;
    }
    const distanceKm = Math.max(routeDistanceMeters(coordinates) / 1000, 0.1);
    const curvesPerKm = meaningfulTurns / distanceKm;
    return { curveScore: Math.min(100, Math.round(curvesPerKm * 22)), curvesPerKm: Number(curvesPerKm.toFixed(2)) };
};
