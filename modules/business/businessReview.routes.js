import { rateLimitError } from '../../middleware/rateLimitError.js';
import express from 'express';
import rateLimit from 'express-rate-limit';

import * as businessReviewController from "./businessReview.controller.js";
import { protect } from "../../middleware/authMiddleware.js";

const router = express.Router();
const reviewWriteLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { status: 'error', message: 'Çok fazla değerlendirme işlemi yaptınız. Lütfen biraz bekleyin.' }
});

router.get('/:businessId', businessReviewController.getBusinessReviews);
router.put('/:businessId', protect, reviewWriteLimiter, businessReviewController.upsertBusinessReview);
router.delete('/:businessId/:reviewId', protect, reviewWriteLimiter, businessReviewController.deleteBusinessReview);

export default router;
