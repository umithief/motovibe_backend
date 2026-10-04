/**
 * RevenueCat Webhook Route
 * Mounted at: /api/webhooks/revenuecat
 */

import express from 'express';
import { handleRevenueCatWebhook } from '../controllers/revenuecatWebhook.js';

const router = express.Router();

// The global JSON parser stores req.rawBody for this route before parsing.
router.post('/', handleRevenueCatWebhook);

export default router;
