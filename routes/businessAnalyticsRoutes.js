import express from 'express';
import rateLimit from 'express-rate-limit';

import * as businessAnalyticsController from '../controllers/businessAnalyticsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
const eventLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { status: 'error', message: 'Analitik işlem limiti aşıldı.' }
});

router.use(protect);
router.post('/events', eventLimiter, businessAnalyticsController.recordBusinessAnalyticsEvent);
router.get('/dashboard', businessAnalyticsController.getBusinessAnalyticsDashboard);

export default router;
