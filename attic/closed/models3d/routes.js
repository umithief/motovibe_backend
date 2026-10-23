import * as controller from "./controller.js";

import express from 'express';

import { admin, protect } from "../../../middleware/authMiddleware.js";

const router = express.Router();

// GET all models
router.get('/', controller.get);

// POST new model
router.post('/', protect, admin, controller.post);

// DELETE model
router.delete('/:id', protect, admin, controller.deleteId);

export default router;
