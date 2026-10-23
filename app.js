import { sendResponse } from './utils/respond.js';
import AppError from './utils/appError.js';
import catchAsync from './utils/catchAsync.js';
import { serializeMediaUrls } from './utils/serializeMediaUrls.js';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAllowedOrigins, getBodyLimit } from './config/env.js';
import { attachRequestId, createCorsOptions, rejectUnsafeMongoKeys, setSecurityHeaders } from './middleware/securityMiddleware.js';
import { apiNotFound, globalErrorHandler } from './middleware/errorMiddleware.js';
import { getRuntimeCapabilities, disabledReleaseFeature, disabledFeaturePrefixes } from './config/release.js';
import uploadRoutes from "./modules/uploads/routes.js";
import routeRoutes from "./modules/routes/routes.js";
import { lazyRouter } from './utils/lazyModule.js';
import slideRoutes from "./modules/slides/routes.js";
import storyRoutes from "./modules/stories/routes.js";
import eventRoutes from './modules/events/routes.js';
import feedbackRoutes from "./modules/feedback/routes.js";
import analyticsRoutes from "./modules/analytics/routes.js";
import activityRoutes from './modules/rides/activities.routes.js';
import userRoutes from "./modules/users/routes.js";
import authRoutes from "./modules/auth/routes.js";
import businessReviewRoutes from "./modules/business/businessReview.routes.js";
import businessAnalyticsRoutes from "./modules/business/businessAnalytics.routes.js";
import businessCommerceRoutes from "./modules/business/routes.js";
import reelRoutes from "./modules/reels/routes.js";
import postRoutes from "./modules/posts/routes.js";
import rideRoutes from "./modules/rides/routes.js";
import uiRoutes from "./modules/ui/routes.js";
import messageRoutes from "./modules/messages/routes.js";
import reportRoutes from "./modules/reports/routes.js";
import notificationRoutes from "./modules/notifications/routes.js";
import emojiRoutes from "./modules/emojis/routes.js";
import beaconRoutes from "./modules/beacons/routes.js";
import packRoutes from "./modules/packs/routes.js";
import adRoutes from "./modules/ads/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import exploreRoutes from "./modules/discovery/routes.js";
import leaderboardRoutes from "./modules/leaderboards/routes.js";
import campaignRoutes from "./modules/campaigns/routes.js";
import revenuecatWebhookRoute from "./modules/subscriptions/routes.js";
import tagRoutes from "./modules/tags/routes.js";
import appointmentRoutes from "./modules/appointments/routes.js";
import homeRoutes from "./modules/home/routes.js";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./swagger.js";
import "./modules/campaigns/UserChallenge.model.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const createApp = () => {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use(attachRequestId);
    app.use(setSecurityHeaders);
    app.use(compression());
    app.use(cors(createCorsOptions(getAllowedOrigins())));
    // Middleware
    // 1. Logger & Firebase URL Fixer
    app.use((req, res, next) => {
        // Firebase Functions 'api' isimli fonksiyon üzerinden çağrıldığında
        // URL'in başındaki '/api' kısmını kırpar. Bizim rotalarımız '/api'
        // beklediği için, eksikse geri ekliyoruz.
        if (!req.url.startsWith('/api') && req.url !== '/') {
            req.url = '/api' + req.url;
            req.originalUrl = req.url;
        }
        // Disabled by default; never include query strings, IDs or request bodies.
        if (process.env.HTTP_REQUEST_LOGGING === 'true') {
            const startedAt = performance.now();
            res.on('finish', () => console.info(JSON.stringify({
                level: 'info', event: 'http_request', requestId: req.id,
                method: req.method, route: req.route?.path || 'unmatched',
                status: res.statusCode, durationMs: Math.round(performance.now() - startedAt)
            })));
        }
        next();
    });

    // Canonical API shares routers with legacy URLs; bodies stay unchanged on old URLs.
    app.use((req,res,next)=>{
        if(/^\/api\/v2(?:\/|\?|$)/.test(req.url)){req.apiVersion=2;req.url=req.url.replace(/^\/api\/v2(?=\/|\?|$)/,'/api');}
        else req.apiVersion=1;
        next();
    });

    app.use(express.json({
        limit: getBodyLimit(),
        verify: (req, res, buffer) => {
            if (req.url.startsWith('/api/webhooks/revenuecat')) {
                req.rawBody = Buffer.from(buffer);
            }
        },
    }));
    app.use(express.urlencoded({ limit: getBodyLimit(), extended: true }));
    app.use(rejectUnsafeMongoKeys);

    // Uploads klasörünü dışarıya aç (Range request desteği ile)
    app.use('/api/uploads', (req, res, next) => {
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Range');
        res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    }, express.static(path.join(__dirname, 'uploads'), {
        setHeaders: (res, path) => {
            res.setHeader('Accept-Ranges', 'bytes');
        },
        fallthrough: true
    }), (req, res, next) => {
        // Fallback: file not found but still send CORS headers
        next(new AppError('Dosya bulunamadı.',404));
    });

    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        handler:(req,res,next)=>next(new AppError('Cok fazla kimlik dogrulama istegi. Lutfen daha sonra tekrar deneyin.',429))
    });

    const globalLimiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 300, // Limit each IP to 300 requests per windowMs
        handler:(req,res,next)=>next(new AppError('Çok fazla istek. Lütfen daha sonra tekrar dene.',429)),
        standardHeaders: 'draft-8',
        legacyHeaders: false,
    });

    app.use(globalLimiter);
    app.use('/api/users/login', authLimiter);
    app.use('/api/users/register', authLimiter);


    const capabilities = getRuntimeCapabilities();
    for (const [feature, prefixes] of Object.entries(disabledFeaturePrefixes)) {
        if (!capabilities[feature]) app.use(prefixes, disabledReleaseFeature);
    }
    app.locals.capabilities = Object.freeze({ ...capabilities });

    // Rewrite legacy campaign paths without changing methods, bodies or response codes.
    app.use((req, res, next) => {
        const [pathname, ...query] = req.url.split('?');
        const prefix = ['/api/sponsorship/campaigns', '/api/sponsorship', '/api/campaigns']
            .find(value => pathname === value || pathname.startsWith(value + '/'));
        if (prefix) {
            let suffix = pathname.slice(prefix.length).replace(/^\/campaigns(?=\/|$)/, '');
            if (suffix === '/challenges/my') suffix = '/my';
            req.url = '/api/campaigns' + (suffix || '/') + (query.length ? '?' + query.join('?') : '');
        }
        next();
    });

    /**
     * @openapi
     * /api/capabilities:
     *   get:
     *     tags: [System]
     *     summary: Çalışma zamanı yeteneklerini getir
     *     description: Sürüm/bayrak bazlı etkin özellikleri döner. Opsiyonel `businessId` ile işletme ödeme yeteneği de hesaplanır.
     *     parameters:
     *       - in: query
     *         name: businessId
     *         schema: { type: string, pattern: '^[a-f0-9]{24}$' }
     *         description: İşletme ödeme yeteneğini kontrol etmek için işletme id'si.
     *     responses:
     *       200:
     *         description: Yetenek haritası.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties: { type: boolean }
     *       400:
     *         $ref: '#/components/responses/ValidationError'
     */
    app.get('/api/capabilities', catchAsync(async (req, res, next) => {
        try {
            const capabilities = getRuntimeCapabilities();
            if (req.query.businessId !== undefined) {
                const id = req.query.businessId;
                if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) {
                    throw new AppError('Geçersiz işletme.',400);
                }
                const business = capabilities.businessCheckout
                    ? await mongoose.model('User').findById(id)
                        .select('userType +businessProfile.iyzicoSubMerchantKey').lean()
                    : null;
                capabilities.businessCheckout = Boolean(business?.userType === 'PROFESSIONAL' &&
                    business.businessProfile?.iyzicoSubMerchantKey?.trim());
            }
            res.set('Cache-Control', 'no-store');
            sendResponse(res.req,res,{ status: 'success', data: capabilities },{statusCode:200});
        } catch (error) { next(error); }
    }));

    // --- API Documentation (Swagger / OpenAPI 3.0) ---
    // Raw spec (valid OpenAPI 3.0.0 JSON) and the interactive Swagger UI.
    // Both paths start with '/api' so the Firebase URL fixer above leaves them untouched.
    app.get('/api-docs.json', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(swaggerSpec);
    });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        explorer: true,
        customSiteTitle: 'MotoVibe / Motonom API Docs',
        // Üstteki info panelini (başlık + versiyon + OAS rozeti + açıklama) gizle.
        customCss: '.swagger-ui .information-container { display: none !important; }',
    }));

    app.use('/api/upload', uploadRoutes);


    app.use('/api/auth', authRoutes);
    app.use('/api/routes', routeRoutes);
    const geoRoutes=lazyRouter(()=>import('./modules/geo/routes.js'));
    app.use('/api',(req,res,next)=>/^\/(geo(?:\/|$)|internal\/providers(?:\/|$))/.test(req.path) ? geoRoutes(req,res,next) : next());
    app.use('/api/slides', slideRoutes);
    app.use('/api/stories', storyRoutes);

    app.use('/api/events', eventRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/business-reviews', businessReviewRoutes);
    app.use('/api/business-analytics', businessAnalyticsRoutes);
    app.use('/api/business-commerce', businessCommerceRoutes);
    app.use('/api/posts', postRoutes); // Using postRoutes as requested
    app.use('/api/social', (req, res) => res.redirect(308, `${req.apiVersion===2?'/api/v2/posts':'/api/posts'}${req.url}`));
    app.use('/api/reels', reelRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/analytics', analyticsRoutes);
    app.use('/api/activities', activityRoutes);
    app.use('/api/rides', rideRoutes);
    app.use('/api/feedback', feedbackRoutes);
    app.use('/api/ui-settings', uiRoutes);
    app.use('/api/messages', messageRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/emojis', emojiRoutes);
    app.use('/api/beacons', beaconRoutes);
    app.use('/api/packs', packRoutes);
    app.use('/api/ads', adRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/explore', exploreRoutes);
    app.use('/api/leaderboard', leaderboardRoutes);
    app.use('/api/campaigns', campaignRoutes);

    app.use('/api/webhooks/revenuecat', revenuecatWebhookRoute);
    app.use('/api/tags', tagRoutes);
    app.use('/api/appointments', appointmentRoutes);
    app.use('/api/home', homeRoutes);

    /**
     * @openapi
     * /api/health:
     *   get:
     *     tags: [System]
     *     summary: Sağlık kontrolü
     *     responses:
     *       200:
     *         description: Servis ayakta.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 service: { type: string, example: motovibe-api }
     *                 uptimeSeconds: { type: integer, example: 3600 }
     */
    app.get('/api/health', (req, res) => {
        sendResponse(res.req,res,{
            status: 'success',
            data: {
                service: 'motovibe-api',
                uptimeSeconds: Math.floor(process.uptime()),
            },
        },{statusCode:200});
    });

    app.use('/api', apiNotFound);

    // --- FRONTEND STATIK DOSYALARINI SERVIS ET (PROD) ---
    // Firebase ortamında bu özelliği devre dışı bırakıyoruz (sadece API çalışsın)
    const isFirebase = process.env.FIREBASE_CONFIG !== undefined || process.env.FUNCTIONS_EMULATOR === 'true';

    const frontendPath = path.join(__dirname, '../dist');
    const hasFrontendDist = fs.existsSync(path.resolve(frontendPath, 'index.html'));

    if (!isFirebase && hasFrontendDist && (process.env.NODE_ENV === 'production' || process.env.SERVE_FRONTEND === 'true')) {
        app.use(express.static(frontendPath));

        app.get(/(.*)/, (req, res, next) => {
            if (req.path.startsWith('/api')) { // API isteklerini engelleme
                return next(new AppError('API route found but method not handled or path wrong',404));
            }
            res.sendFile(path.resolve(frontendPath, 'index.html'));
        });
    } else {
        // Bilgilendirme ve Healthcheck
        app.get('/', (req, res) => {
            res.send('Motonom Backend API Çalışıyor!');
        });
    }


    app.use(globalErrorHandler);
    return app;
};
export default createApp();
