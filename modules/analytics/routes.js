import * as controller from './controller.js';


import express from 'express';

import { admin, protect } from "../../middleware/authMiddleware.js";


const router = express.Router();

const protectFeedAnalytics = (req, res, next) => {
    const eventType = typeof req.body?.type === 'string'
        ? req.body.type.trim()
        : '';
    if (eventType.startsWith('feed_')) {
        return protect(req, res, next);
    }
    return next();
};

// POST /api/analytics/visit
router.post('/visit', controller.postVisit);

// GET /api/analytics/visitors
router.get('/visitors', protect, admin, controller.getVisitors);

// POST /api/analytics/event
router.post('/event', protectFeedAnalytics, controller.postEvent);

// GET /api/analytics/dashboard
router.get('/dashboard', protect, admin, controller.getDashboard);

export default router;

export { summarizeFeedAnalytics } from './rules.service.js';
