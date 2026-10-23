import * as controller from './controller.js';

import express from 'express';


const router = express.Router();

// GET all feedback
router.get('/', controller.get);

// POST new feedback
router.post('/', controller.post);

export default router;
