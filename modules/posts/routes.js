import os from 'os';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { admin, protect, checkUser } from "../../middleware/authMiddleware.js";
import * as postController from "./controller.js";

import { getDiscoveryFeed } from "../discovery/feed.controller.js";
import { getVibeSettings, updateVibeSettings } from "../discovery/feed.controller.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure Multer for memory storage
const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

// Public Routes (no token needed)
router.get('/user/:id/posts', postController.getUserPosts);
router.get('/search', postController.search);
router.get('/explore', checkUser, postController.getExplorePosts);  // Public: Explore feed
router.get('/tag/:tag', postController.getPostsByTag);

// VibeEngine Discovery Feed (public for unauthenticated browsing)
router.get('/discover', checkUser, getDiscoveryFeed);

// Protected Static Routes (MUST be defined before /:id to prevent CastError)
router.get('/feed', protect, postController.getFeedPosts);
router.get('/saved', protect, postController.getSavedPosts);
router.get('/config', protect, getVibeSettings);
router.put('/config', protect, admin, updateVibeSettings);
router.get('/tagged/:id', protect, postController.getTaggedPosts);

// Post Stream Feed & Detail (parameterized routes)
router.get('/:id/feed', checkUser, postController.getPostStreamFeed);
router.get('/:id/comments', checkUser, postController.getPostComments);
router.get('/:id', checkUser, postController.getPostById);

// Protected Mutation Routes
router.post('/', protect, postController.createPost);
router.post('/:id/like', protect, postController.toggleLike);
router.post('/:id/save', protect, postController.savePost);
router.post('/:id/comments', protect, postController.addComment);
router.patch('/:id/tags/remove-me', protect, postController.removeMyTag);
router.patch('/:id/tags', protect, postController.updatePostTags);
router.put('/comments/:commentId', protect, postController.updateComment);
router.delete('/comments/:commentId', protect, postController.deleteComment);
router.delete('/:id', protect, postController.deletePost);
router.put('/:id', protect, postController.updatePost);

export default router;
