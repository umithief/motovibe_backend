import { Router } from 'express';
import { protect } from '../../middleware/authMiddleware.js';
import { getLatestActivity,createActivity } from './activities.controller.js';
const router=Router();
router.get('/latest',protect,getLatestActivity);
router.post('/',protect,createActivity);
export default router;
