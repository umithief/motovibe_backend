import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, admin } from '../middleware/authMiddleware.js';
import { createReport, getAdminReports, resolveReport } from '../controllers/reportController.js';

const router = express.Router();

// Rate limiting for reports (max 5 per hour per IP)
const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: {
        status: 'error',
        message: 'Saatlik maksimum şikayet limitine (5) ulaştınız. Lütfen daha sonra tekrar deneyin.'
    },
    validate: { xForwardedForHeader: false } // Fixes express-rate-limit behind Nginx without trust proxy
});

// Protect all report routes
router.use(protect);

// User submitting a report
router.post('/', reportLimiter, createReport);

// Admin Routes for Moderation
router.use(admin);

router.get('/admin', getAdminReports);
router.post('/admin/:id/resolve', resolveReport);

export default router;
