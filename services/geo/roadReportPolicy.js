export const roadReportCategories = new Set([
    'hazard',
    'construction',
    'gravel',
    'poor_surface',
    'accident',
    'police_control',
    'road_closure',
    'flood',
    'animal_hazard',
    'oil_slippery',
    'other'
]);

const defaultTtlHours = {
    accident: 6,
    police_control: 6,
    oil_slippery: 12,
    animal_hazard: 12,
    hazard: 24,
    flood: 24,
    gravel: 72,
    poor_surface: 72,
    construction: 168,
    road_closure: 168,
    other: 24
};

export const resolveRoadReportExpiry = ({ category, ttlHours, expiresAt, now = new Date(), maxTtlHours = 168 }) => {
    const requestedExpiry = expiresAt ? new Date(expiresAt) : null;
    if (requestedExpiry && Number.isNaN(requestedExpiry.getTime())) return null;

    const defaultHours = defaultTtlHours[category] || defaultTtlHours.other;
    const requestedHours = Number(ttlHours);
    const hours = Number.isFinite(requestedHours)
        ? Math.min(Math.max(requestedHours, 1), maxTtlHours)
        : defaultHours;
    const maxExpiry = new Date(now.getTime() + maxTtlHours * 60 * 60 * 1000);
    if (requestedExpiry) {
        if (requestedExpiry <= now) return null;
        return requestedExpiry > maxExpiry ? maxExpiry : requestedExpiry;
    }
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
};
