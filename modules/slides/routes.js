import * as controller from './controller.js';

import express from 'express';

import { admin, protect, checkUser } from "../../middleware/authMiddleware.js";


const router = express.Router();

// GET /api/slides
router.get('/', checkUser, controller.get);

// PUT /api/slides/reorder
router.put('/reorder', protect, admin, controller.putReorder);

// POST /api/slides
router.post('/', protect, admin, controller.post);

// PUT /api/slides/:id
router.put('/:id', protect, admin, controller.putId);

// DELETE /api/slides/:id
router.delete('/:id', protect, admin, controller.deleteId);

export default router;
