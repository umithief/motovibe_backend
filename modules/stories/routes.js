import express from 'express';
import {
    createStory,
    getStories,
    viewStory,
    likeStory,
    unlikeStory,
    reactToStory,
    replyToStory,
    deleteStory,
    getStoryViewers,
    createHighlight,
    getUserHighlights,
    deleteHighlight
} from "./controller.js";
import { protect, checkUser } from "../../middleware/authMiddleware.js";

const router = express.Router();

router.route('/')
    .post(protect, createStory)
    .get(checkUser, getStories);

// Highlight routes (placed before /:id)
router.route('/highlights')
    .post(protect, createHighlight);

router.route('/highlights/user/:userId')
    .get(checkUser, getUserHighlights);

router.route('/highlights/:id')
    .delete(protect, deleteHighlight);

router.route('/:id')
    .delete(protect, deleteStory);

router.route('/:id/viewers')
    .get(protect, getStoryViewers);

router.route('/:id/view')
    .post(protect, viewStory);

router.route('/:id/like')
    .post(protect, likeStory)
    .delete(protect, unlikeStory);

router.route('/:id/react')
    .post(protect, reactToStory);

router.route('/:id/reply')
    .post(protect, replyToStory);

export default router;
