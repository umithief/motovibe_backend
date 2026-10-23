import { rateLimitError } from '../../middleware/rateLimitError.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    getThreads,
    getUnreadCount,
    getConversation,
    sendMessage,
    deleteConversation,
    deleteMessage,
    toggleMuteConversation,
    markConversationAsRead,
    respondRideInvite,
    getMyPackLounges
} from "./controller.js";
import { protect } from "../../middleware/authMiddleware.js";

const router = express.Router();

const messageRateLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 10 * 1000, // 10 seconds
    max: 20, // max 20 messages per 10 seconds per user
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ipKeyGeneratorFallback: false, default: false },
    keyGenerator: (req) => req.user?._id?.toString?.() || req.ip || 'anon',
    message: {
        status: 'error',
        message: 'Çok hızlı mesaj gönderiyorsunuz. Lütfen birkaç saniye bekleyin.'
    }
});

router.use(protect);

router.get('/threads', getThreads);
router.get('/unread-count', getUnreadCount);
router.get('/lounges', getMyPackLounges);
router.get('/conversation/:userId', getConversation);
router.post('/', messageRateLimiter, sendMessage);
router.put('/:messageId/ride-action', respondRideInvite);
router.delete('/conversation/:conversationId', deleteConversation);
router.put('/conversation/:conversationId/mute', toggleMuteConversation);
router.put('/conversation/:conversationId/read', markConversationAsRead);
router.delete('/:messageId', deleteMessage);

export default router;
