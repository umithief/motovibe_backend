const mediaKeys = new Set(['avatar', 'coverImage', 'image', 'thumbnail', 'imageUrl', 'videoUrl', 'emblem']);
export const absoluteMediaUrl = (value, req) => {
    if (typeof value !== 'string') return value;
    const base = (process.env.BASE_URL || (req?.get ? req.protocol + '://' + req.get('host') : 'http://localhost:' + (process.env.PORT || 5001))).replace(/\/+$/, '');
    if (value === 'default-avatar.png') return base + '/api/uploads/default-avatar.png';
    if (/^\/?uploads\//.test(value)) return base + '/api/' + value.replace(/^\//, '');
    return value;
};
// Allocate only changed branches. Dates, ObjectIds and unchanged POJOs retain their types.
// Mongoose documents use the same toJSON conversion Express would perform.
export const serializeMediaUrls = (payload, req) => {
    const visited = new WeakMap();
    const visit = (value, parent = '') => {
        if (!value || typeof value !== 'object') return value;
        if (value.$__ && typeof value.toJSON === 'function') value = value.toJSON();
        if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
        if (visited.has(value)) return visited.get(value);
        let output = value;
        visited.set(value, value);
        for (const key of Object.keys(value)) {
            const item = value[key];
            const media = mediaKeys.has(key) || (key === 'url' && parent === 'media') || (Array.isArray(value) && parent === 'images');
            const next = media && typeof item === 'string' ? absoluteMediaUrl(item, req) : visit(item, Array.isArray(value) ? parent : key);
            if (next !== item) {
                if (output === value) output = Array.isArray(value) ? [...value] : { ...value };
                output[key] = next;
                visited.set(value, output);
            }
        }
        return output;
    };
    return visit(payload);
};
