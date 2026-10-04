
import express from 'express';
import { getSettings, updateSettings } from '../controllers/uiController.js';
import { admin, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getSettings);

// Branding Specific Routes - For cleaner separation we could make a new file, but keeping UI cohesive
import { getBranding, updateBranding } from '../controllers/uiController.js';
router.get('/branding', getBranding);
router.put('/branding', protect, admin, updateBranding);
router.put('/:component', protect, admin, updateSettings);


export default router;
