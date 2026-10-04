import express from 'express';
import { getMotoMojis } from '../controllers/emojiController.js';

const router = express.Router();

router.get('/', getMotoMojis);

export default router;
