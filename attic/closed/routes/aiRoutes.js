import express from 'express';
import { chatWithMotoVibeAi } from "../controllers/aiController.js";
import { protect } from "../../../middleware/authMiddleware.js";

const router = express.Router();

router.post('/chat', protect, chatWithMotoVibeAi);

export default router;
