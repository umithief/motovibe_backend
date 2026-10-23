import * as controller from "./controller.js";

import express from 'express';


import { admin, protect } from "../../../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/categories
router.get('/', controller.get);

// POST /api/categories
router.post('/', protect, admin, controller.post);

// PUT /api/categories/:id
router.put('/:id', protect, admin, controller.putId);

// DELETE /api/categories/:id
router.delete('/:id', protect, admin, controller.deleteId);

export default router;
