import { Router } from 'express';
import { checkUser } from '../../middleware/authMiddleware.js';
import { getHomeSummary } from './controller.js';
const router=Router();
router.get('/summary',checkUser,getHomeSummary);
export default router;
