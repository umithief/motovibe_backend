import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllowedOrigins, getJwtSecret, validateRuntimeEnv } from '../config/env.js';
import { apiNotFound, globalErrorHandler } from '../middleware/errorMiddleware.js';
import {
    attachRequestId,
    createCorsOptions,
    rejectUnsafeMongoKeys,
    setSecurityHeaders,
} from '../middleware/securityMiddleware.js';
import User from "../modules/users/model.js";

const createResponse = () => ({
    headers: {},
    statusCode: null,
    payload: null,
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
});

test('JWT secret zayif veya eksikse reddedilir', { concurrency: false }, () => {
    const previous = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    assert.throws(() => getJwtSecret(), /JWT_SECRET/);
    process.env.JWT_SECRET = 'short';
    assert.throws(() => getJwtSecret(), /32/);
    process.env.JWT_SECRET = 'x'.repeat(32);
    assert.equal(getJwtSecret().length, 32);
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
});

test('CORS origin listesi bosluklari temizler', { concurrency: false }, () => {
    const previous = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = 'https://app.example.com, https://admin.example.com ';
    assert.deepEqual(getAllowedOrigins(), ['https://app.example.com', 'https://admin.example.com']);
    if (previous === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previous;
});

test('Production CORS varsayilani native istemciyi engellemeden tarayicilari kapatir', { concurrency: false }, () => {
    const previous = {
        CORS_ORIGINS: process.env.CORS_ORIGINS,
        JWT_SECRET: process.env.JWT_SECRET,
        MONGO_URI: process.env.MONGO_URI,
        NODE_ENV: process.env.NODE_ENV,
    };

    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test';

    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
        assert.deepEqual(getAllowedOrigins(), []);
        assert.doesNotThrow(() => validateRuntimeEnv());

        const options = createCorsOptions(getAllowedOrigins());
        let nativeAllowed = false;
        options.origin(undefined, (error, allowed) => {
            assert.equal(error, null);
            nativeAllowed = allowed;
        });
        assert.equal(nativeAllowed, true);
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
});

test('NoSQL operator ve nokta iceren anahtarlari reddeder', () => {
    for (const body of [{ profile: { $where: 'true' } }, { 'profile.isAdmin': true }]) {
        let error;
        rejectUnsafeMongoKeys({ body, query: {}, params: {} }, {}, (value) => { error = value; });
        assert.equal(error.statusCode, 400);
    }

    let called = false;
    rejectUnsafeMongoKeys({ body: { profile: { name: 'Rider' } }, query: {}, params: {} }, {}, () => { called = true; });
    assert.equal(called, true);
});

test('Guvenlik basliklari ve request id eklenir', () => {
    const res = createResponse();
    const req = { get: () => 'client_request-123' };
    attachRequestId(req, res, () => {});
    setSecurityHeaders(req, res, () => {});
    assert.equal(req.id, 'client_request-123');
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(res.headers['X-Frame-Options'], 'DENY');
});

test('CORS allowlist disindaki origin reddedilir', async () => {
    const options = createCorsOptions(['https://app.example.com']);
    await assert.rejects(
        () => new Promise((resolve, reject) => options.origin('https://evil.example.com', (error) => error ? reject(error) : resolve())),
        (error) => error.statusCode === 403
    );
});

test('Duplicate kayit 409, beklenmeyen hata guvenli 500 doner', () => {
    const duplicateRes = createResponse();
    globalErrorHandler(
        { code: 11000, keyValue: { email: 'hidden@example.com' } },
        { id: 'request-duplicate' },
        duplicateRes,
        () => {}
    );
    assert.equal(duplicateRes.statusCode, 409);
    assert.equal(duplicateRes.payload.field, 'email');

    const internalRes = createResponse();
    const originalError = console.error;
    console.error = () => {};
    try {
        globalErrorHandler(new Error('database host is secret'), { id: 'request-internal' }, internalRes, () => {});
    } finally {
        console.error = originalError;
    }
    assert.equal(internalRes.statusCode, 500);
    assert.equal(internalRes.payload.message, 'Beklenmeyen bir sunucu hatasi olustu.');
});

test('Bilinmeyen API yolu 404 AppError uretir', () => {
    let error;
    apiNotFound({ method: 'GET', originalUrl: '/api/missing' }, {}, (value) => { error = value; });
    assert.equal(error.statusCode, 404);
});

test('Kullanici sifresi varsayilan sorgulardan haric tutulur', () => {
    assert.equal(User.schema.path('password').options.select, false);
});
