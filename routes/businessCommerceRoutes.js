import express from 'express';

import * as businessCommerceController from '../controllers/businessCommerceController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.post('/iyzico/callback', businessCommerceController.handleIyzicoCallback);
router.post('/iyzico/webhook', businessCommerceController.handleIyzicoWebhook);
router.use(protect);
router.post('/checkout', businessCommerceController.initializeBusinessCheckout);
router.get('/summary', businessCommerceController.getBusinessCommerceSummary);
router.get('/settlements', businessCommerceController.getBusinessSettlements);

export default router;
