import { Router } from 'express';
import { checkUser } from "../../middleware/authMiddleware.js";
import { getExploreFeed } from "./feed.controller.js";
import { universalSearch, getTrending } from "./controller.js";

const router = Router();

// GET /api/explore
router.get('/', checkUser, getExploreFeed);

// GET /api/explore/search?q=...
router.get('/search', checkUser, universalSearch);

// GET /api/explore/trending
router.get('/trending', checkUser, getTrending);

export default router;
