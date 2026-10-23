import express from 'express';
import { protect, admin as requireAdmin } from "../../middleware/authMiddleware.js";
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearReadNotifications,
    sendNotificationToUser
} from "./controller.js";

const router = express.Router();

router.use(protect);
router.post('/send', requireAdmin, sendNotificationToUser);
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllAsRead);
router.delete('/read', clearReadNotifications);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

export default router;
