import { rateLimitError } from '../../middleware/rateLimitError.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createRoadReport, getNearbyPois, getNearbyRoadReports, getProviderHealth } from "./controller.js";
import { protect, admin } from "../../middleware/authMiddleware.js";

const router = express.Router();

const geoReadLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }
});

const geoWriteLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }
});

router.get('/geo/poi/nearby', geoReadLimiter, getNearbyPois);
router.get('/geo/reports/nearby', geoReadLimiter, getNearbyRoadReports);
router.post('/geo/reports', protect, geoWriteLimiter, createRoadReport);
router.get('/internal/providers/health', protect, admin, getProviderHealth);

export default router;
