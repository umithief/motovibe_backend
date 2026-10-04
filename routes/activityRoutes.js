import express from 'express';
import { getLatestActivity, createActivity } from '../controllers/activityController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/latest', protect, getLatestActivity);
router.post('/', protect, createActivity);

export default router;
