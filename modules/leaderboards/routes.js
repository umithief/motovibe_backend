import express from 'express';
import { protect } from "../../middleware/authMiddleware.js";
import { getLeaderboard, resetLeaderboard } from "./controller.js";

const router = express.Router();

router.post('/reset', protect, resetLeaderboard);

router.get('/', protect, (req, res, next) => {
    req.params.category = req.query.category || 'weekly_distance';
    return getLeaderboard(req, res, next);
});

router.get('/:category', protect, getLeaderboard);

export default router;
