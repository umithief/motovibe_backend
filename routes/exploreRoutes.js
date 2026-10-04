import { Router } from 'express';
import { universalSearch, getTrending } from '../controllers/exploreController.js';

const router = Router();

// GET /api/explore
router.get('/', getTrending);

// GET /api/explore/search?q=...
router.get('/search', universalSearch);

// GET /api/explore/trending
router.get('/trending', getTrending);

export default router;
