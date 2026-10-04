import crypto from 'crypto';
import AppError from '../utils/appError.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

const findUnsafeKey = (value, path = '') => {
    if (!value || typeof value !== 'object') return null;

    for (const [key, nestedValue] of Object.entries(value)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (key.startsWith('$') || key.includes('.')) return currentPath;
        const nestedUnsafeKey = findUnsafeKey(nestedValue, currentPath);
        if (nestedUnsafeKey) return nestedUnsafeKey;
    }

    return null;
};

export const rejectUnsafeMongoKeys = (req, res, next) => {
    const unsafeKey = findUnsafeKey({
        body: req.body,
        query: req.query,
        params: req.params,
    });

    if (unsafeKey) {
        return next(new AppError('Istek izin verilmeyen bir alan iceriyor.', 400));
    }

    return next();
};

export const attachRequestId = (req, res, next) => {
    const suppliedId = req.get('x-request-id');
    req.id = suppliedId && REQUEST_ID_PATTERN.test(suppliedId)
        ? suppliedId
        : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
};

export const setSecurityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
};

export const createCorsOptions = (allowedOrigins) => ({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new AppError('Bu origin icin CORS izni yok.', 403));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Range'],
    exposedHeaders: ['X-Request-Id', 'Content-Range', 'Content-Length', 'Accept-Ranges'],
    maxAge: 600,
});
