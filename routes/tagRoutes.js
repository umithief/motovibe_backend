import express from 'express';
import {
  followTag,
  getTagDetails,
  getTrendingTags,
  searchTags,
  unfollowTag,
} from '../controllers/tagController.js';
import { checkUser, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/trending', checkUser, getTrendingTags);
router.get('/search', checkUser, searchTags);
router.get('/:name', checkUser, getTagDetails);

router.use(protect);
router.post('/:name/follow', followTag);
router.post('/:name/unfollow', unfollowTag);

export default router;
