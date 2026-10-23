import express from 'express';
import { getMotoMojis } from "./controller.js";

const router = express.Router();

router.get('/', getMotoMojis);

export default router;
