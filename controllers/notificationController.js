import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendNotification } from '../socket.js';
import admin from 'firebase-admin';

const TYPE_TO_PREF_MAP = {
    LIKE: 'likes',
    like: 'likes',
    COMMENT: 'comments',
    comment: 'comments',
    REEL_LIKE: 'likes',
    reel_like: 'likes',
    VIBECUT_LIKE: 'likes',
    vibecut_like: 'likes',
    REEL_COMMENT: 'comments',
    reel_comment: 'comments',
    VIBECUT_COMMENT: 'comments',
    vibecut_comment: 'comments',
    ROUTE_SAVED: 'rides',
    route_saved: 'rides',
    ROUTE_REVIEW: 'rides',
    route_review: 'rides',
    ROUTE_HAZARD: 'rides',
    route_hazard: 'rides',
    VIBECUT_ROUTE_LINKED: 'rides',
    vibecut_route_linked: 'rides',
    FOLLOW: 'follows',
    follow: 'follows',
    JOIN_REQUEST: 'packs',
    join_request: 'packs',
    JOIN_APPROVED: 'packs',
    join_approved: 'packs',
    JOIN_REJECTED: 'packs',
    join_rejected: 'packs',
    PACK_MEMBER_REMOVED: 'packs',
    pack_member_removed: 'packs',
    APPOINTMENT_REQUEST: 'appointments',
    appointment_request: 'appointments',
    APPOINTMENT_UPDATE: 'appointments',
    appointment_update: 'appointments',
    APPOINTMENT_APPROVED: 'appointments',
    appointment_approved: 'appointments',
    APPOINTMENT_REJECTED: 'appointments',
    appointment_rejected: 'appointments',
    APPOINTMENT_IN_PROGRESS: 'appointments',
    appointment_in_progress: 'appointments',
    APPOINTMENT_COMPLETED: 'appointments',
    appointment_completed: 'appointments',
    APPOINTMENT_CANCELLED: 'appointments',
    appointment_cancelled: 'appointments',
    RIDE_INVITE: 'rides',
    ride_invite: 'rides',
    RIDE_JOIN: 'rides',
    ride_join: 'rides',
    RIDE_CANCELLED: 'rides',
    ride_cancelled: 'rides',
    RIDE_COMPLETED: 'rides',
    ride_completed: 'rides',
    ACHIEVEMENT_UNLOCKED: 'achievements',
    achievement_unlocked: 'achievements',
};

const PUSH_COPY = {
    LIKE: (sender) => ({
        title: 'Yeni Beğeni',
        body: `${sender?.name || 'Bir sürücü'} gönderini beğendi.`
    }),
    COMMENT: (sender) => ({
        title: 'Yeni Yorum',
        body: `${sender?.name || 'Bir sürücü'} gönderine yorum yaptı.`
    }),
    REEL_LIKE: (sender) => ({
        title: 'VibeCut Beğenisi',
        body: `${sender?.name || 'Bir sürücü'} VibeCut videonu beğendi.`
    }),
    VIBECUT_LIKE: (sender) => ({
        title: 'VibeCut Beğenisi',
        body: `${sender?.name || 'Bir sürücü'} VibeCut videonu beğendi.`
    }),
    REEL_COMMENT: (sender) => ({
        title: 'VibeCut Yorumu',
        body: `${sender?.name || 'Bir sürücü'} VibeCut videona yorum yaptı.`
    }),
    VIBECUT_COMMENT: (sender) => ({
        title: 'VibeCut Yorumu',
        body: `${sender?.name || 'Bir sürücü'} VibeCut videona yorum yaptı.`
    }),
    VIBECUT_ROUTE_LINKED: (sender) => ({
        title: 'Rotan VibeCut\'ta Öne Çıkarıldı',
        body: `${sender?.name || 'Bir sürücü'} rotanı VibeCut videosuna ekledi.`
    }),
    ROUTE_SAVED: (sender) => ({
        title: 'Rota Kaydedildi',
        body: `${sender?.name || 'Bir sürücü'} rotanı kaydetti ve favorilerine ekledi.`
    }),
    ROUTE_REVIEW: (sender) => ({
        title: 'Rota Değerlendirmesi',
        body: `${sender?.name || 'Bir sürücü'} rotana yeni bir inceleme ekledi.`
    }),
    ROUTE_HAZARD: (sender) => ({
        title: 'Yol Tehlikesi Uyarısı ⚠️',
        body: `${sender?.name || 'Bir sürücü'} rotan üzerinde bir yol tehlikesi bildirdi.`
    }),
    FOLLOW: (sender) => ({
        title: 'Yeni Takipçi',
        body: `${sender?.name || 'Bir sürücü'} seni takip etmeye başladı.`
    }),
    JOIN_REQUEST: (sender) => ({
        title: 'Klan Katılım Talebi',
        body: `${sender?.name || 'Bir sürücü'} klanına katılmak istiyor.`
    }),
    JOIN_APPROVED: (sender) => ({
        title: 'Klan İsteği Onaylandı',
        body: `${sender?.name || 'Klan lideri'} klan katılma isteğini onayladı.`
    }),
    JOIN_REJECTED: () => ({
        title: 'Klan İsteği Reddedildi',
        body: 'Klan katılma isteğin reddedildi.'
    }),
    PACK_MEMBER_REMOVED: () => ({
        title: 'Klan Bildirimi',
        body: 'Klandan çıkarıldın.'
    }),
    REPORT_RESOLVED: () => ({
        title: 'Geri Bildirim Çözümlendi',
        body: 'Geri bildiriminiz incelendi ve çözümlendi.'
    }),
    APPOINTMENT_REQUEST: () => ({
        title: 'Yeni randevu talebi',
        body: 'Yeni bir randevu talebin var. BİZ kokpitinden inceleyebilirsin.'
    }),
    APPOINTMENT_UPDATE: () => ({
        title: 'Randevu güncellendi',
        body: 'Randevunun durumu değişti. Ayrıntıları görüntülemek için dokun.'
    }),
    APPOINTMENT_APPROVED: () => ({
        title: 'Randevu onaylandı',
        body: 'İşletme randevunu onayladı.'
    }),
    APPOINTMENT_REJECTED: () => ({
        title: 'Randevu reddedildi',
        body: 'İşletme randevu talebin için bir açıklama paylaştı.'
    }),
    APPOINTMENT_IN_PROGRESS: () => ({
        title: 'Randevu işleme alındı',
        body: 'İşletme hizmetini işleme aldı.'
    }),
    APPOINTMENT_COMPLETED: () => ({
        title: 'Randevu tamamlandı',
        body: 'Hizmet tamamlandı. Ayrıntıları görüntüleyebilirsin.'
    }),
    APPOINTMENT_CANCELLED: () => ({
        title: 'Randevu iptal edildi',
        body: 'Randevu iptal edildi. Ayrıntıları görüntüleyebilirsin.'
    }),
    RIDE_INVITE: (sender) => ({
        title: 'Sürüş Daveti',
        body: `${sender?.name || 'Bir sürücü'} seni bir sürüşe davet etti.`
    }),
    RIDE_JOIN: (sender) => ({
        title: 'Sürüşe Yeni Katılım',
        body: `${sender?.name || 'Bir sürücü'} oluşturduğun sürüşe katıldı.`
    }),
    RIDE_CANCELLED: () => ({
        title: 'Sürüş İptal Edildi',
        body: 'Planlanan sürüş iptal edildi.'
    }),
    RIDE_COMPLETED: () => ({
        title: 'Sürüş Tamamlandı',
        body: 'Sürüş başarıyla tamamlandı!'
    }),
    ACHIEVEMENT_UNLOCKED: () => ({
        title: 'Yeni Başarım!',
        body: 'Yeni bir başarımın kilidini açtın!'
    }),
    SOS: (sender) => ({
        title: '🚨 ACİL DURUM (SOS) UYARISI',
        body: `${sender?.name || 'Yakındaki bir sürücü'} acil durum (SOS) sinyali verdi!`
    }),
    HAZARD: () => ({
        title: '⚠️ Yol Tehlikesi Bildirimi',
        body: 'Güzergahında yeni bir yol tehlikesi veya engel bildirildi.'
    })
};

const sendPushNotification = async ({ recipientUser, senderUser, type, post, reel, pack, appointment, route, reelId, routeId, rideId }) => {
    if (!admin.apps.length) return;

    // Check master push enabled switch
    if (recipientUser?.notifications?.pushEnabled === false) return;

    const upperType = type.toUpperCase();
    const copyBuilder = PUSH_COPY[upperType];
    if (!copyBuilder) return;

    const copy = copyBuilder(senderUser);
    const tokens = (recipientUser?.pushTokens || []).map((entry) => entry.token).filter(Boolean);
    if (tokens.length === 0) return;

    const resolvedReelId = reelId || (reel ? String(reel._id || reel) : '');
    const resolvedRouteId = routeId || (route ? String(route._id || route) : '') || (rideId ? String(rideId) : '');

    try {
        const response = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: copy,
            data: {
                type: type.toLowerCase(),
                postId: post ? String(post) : '',
                packId: pack ? String(pack) : '',
                appointmentId: appointment ? String(appointment) : '',
                senderId: senderUser?._id ? String(senderUser._id) : '',
                reelId: resolvedReelId,
                routeId: resolvedRouteId,
                route: resolvedRouteId,
                rideId: rideId ? String(rideId) : '',
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'motovibe_heads_up_channel',
                    priority: 'max',
                    sound: 'default',
                    defaultSound: true,
                    defaultVibrateTimings: true,
                    visibility: 'public'
                }
            },
            apns: { payload: { aps: { sound: 'default', 'content-available': 1 } } }
        });

        const invalidTokens = [];
        response.responses.forEach((item, index) => {
            const code = item.error?.code || '';
            if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
                invalidTokens.push(tokens[index]);
            }
        });

        if (invalidTokens.length > 0) {
            await User.updateOne({ _id: recipientUser._id }, { $pull: { pushTokens: { token: { $in: invalidTokens } } } });
        }
    } catch (err) {
        console.warn('[Notification] Push send error:', err.message);
    }
};

// Get notifications for the current user
export const getNotifications = async (req, res) => {
    try {
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const notifications = await Notification.find({ recipient: userId })
            .populate('sender', 'name username avatar')
            .populate('post', 'mediaUrl type caption images media') // To show thumbnail
            .populate('reel', 'videoUrl caption thumbnailUrl') // VibeCut video & cover
            .populate('route', 'title name distance location image') // Linked Route
            .populate('pack', 'name avatar emblem') // To show pack details for join requests
            .populate('appointment', 'service date status statusReason') // For MotoVibe BİZ Appointments
            .populate('ride', 'title startPoint endPoint name distance coordinates')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const totalUnread = await Notification.countDocuments({ recipient: userId, isRead: false });
        const total = await Notification.countDocuments({ recipient: userId });

        res.status(200).json({
            notifications,
            totalUnread,
            unreadCount: totalUnread,
            hasMore: total > page * limit,
            total,
            page
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Lightweight endpoint to get unread notification count
export const getUnreadCount = async (req, res) => {
    try {
        const userId = req.user._id;
        const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });
        res.status(200).json({
            unreadCount,
            count: unreadCount,
            totalUnread: unreadCount
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Mark a single notification as read
export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const notification = await Notification.findOneAndUpdate(
            { _id: id, recipient: userId },
            { isRead: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        res.status(200).json(notification);
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Mark ALL notifications as read
export const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user._id;
        await Notification.updateMany(
            { recipient: userId, isRead: false },
            { isRead: true }
        );
        res.status(200).json({ message: 'All marked as read', success: true });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Delete a notification
export const deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const deleted = await Notification.findOneAndDelete({ _id: id, recipient: userId });

        if (!deleted) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        res.status(200).json({ message: 'Notification deleted', success: true });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Bulk clear read notifications
export const clearReadNotifications = async (req, res) => {
    try {
        const userId = req.user._id;
        const { ids } = req.body || {};

        const filter = { recipient: userId, isRead: true };
        if (Array.isArray(ids) && ids.length > 0) {
            filter._id = { $in: ids };
        }

        const result = await Notification.deleteMany(filter);
        res.status(200).json({
            message: 'Read notifications cleared',
            deletedCount: result.deletedCount,
            success: true
        });
    } catch (error) {
        console.error('Error clearing read notifications:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Internal Helper to create notification (called from other controllers like Post/User/Route/Achievement)
export const createNotification = async ({
    recipient,
    sender,
    type,
    post,
    pack,
    appointment,
    commentId,
    route,
    ride,
    rideId,
    relatedId,
    text,
    reel,
    reelId,
    routeId
}) => {
    try {
        if (!recipient || !sender) return;
        const upperType = type ? String(type).toUpperCase() : 'LIKE';

        // Don't notify self, except for system/achievement unlock events
        if (recipient.toString() === sender.toString() && upperType !== 'ACHIEVEMENT_UNLOCKED') return;

        // 1. Check recipient notification preferences
        const recipientUser = await User.findById(recipient)
            .select('notifications pushTokens name')
            .lean();

        if (!recipientUser) return;

        const prefKey = TYPE_TO_PREF_MAP[upperType] || TYPE_TO_PREF_MAP[upperType.toLowerCase()];
        if (prefKey && recipientUser.notifications && recipientUser.notifications[prefKey] === false) {
            console.log(`ℹ️ [Notification] Skipped type=${upperType} due to user preference '${prefKey}: false' for user=${recipient}`);
            return;
        }

        // 2. Fetch sender info for push & socket
        const senderUser = await User.findById(sender).select('name username avatar').lean();

        const resolvedRide = ride || (typeof route === 'object' && route?._id ? route._id : undefined);
        const resolvedRideId = rideId || (typeof ride === 'string' ? ride : undefined) || (route ? String(route) : undefined);
        const resolvedRoute = route || (routeId ? routeId : undefined);
        const resolvedRouteId = routeId || (typeof route === 'string' ? route : (route?._id ? String(route._id) : undefined));
        const resolvedReel = reel || (reelId ? reelId : undefined);
        const resolvedReelId = reelId || (typeof reel === 'string' ? reel : (reel?._id ? String(reel._id) : undefined));

        // 3. Create Notification in Database (UPPERCASE matching schema enum)
        const notification = await Notification.create({
            recipient,
            sender,
            type: upperType,
            text: text || undefined,
            post: post || undefined,
            reel: resolvedReel || undefined,
            pack: pack || undefined,
            appointment: appointment || undefined,
            ride: resolvedRide || undefined,
            route: resolvedRoute || undefined,
            rideId: resolvedRideId || undefined,
            routeId: resolvedRouteId || undefined,
            reelId: resolvedReelId || undefined,
            relatedId: relatedId || resolvedReelId || resolvedRouteId || resolvedRideId || (post ? String(post) : undefined),
            commentId: commentId || undefined
        });

        console.log(`✅ [Notification] Created: type=${upperType}, to=${recipient}, from=${sender}`);

        // 4. Populate for socket emission (non-blocking, error-safe)
        let populatedData = null;
        try {
            const populated = await Notification.findById(notification._id)
                .populate('sender', 'name username avatar')
                .populate('post', 'caption images media mediaUrl type')
                .populate('reel', 'caption videoUrl thumbnailUrl')
                .populate('route', 'title name distance location image')
                .populate('pack', 'name avatar emblem')
                .populate('appointment', 'service date status statusReason')
                .populate('ride', 'title startPoint endPoint name distance coordinates')
                .lean();
            populatedData = populated;
        } catch (popErr) {
            console.warn('⚠️ [Notification] Populate failed, sending raw:', popErr.message);
            populatedData = notification.toObject();
        }

        // 5. Emit via Socket
        sendNotification(recipient, type.toLowerCase(), {
            _id: populatedData._id,
            sender: populatedData.sender || senderUser,
            type: (populatedData.type || type).toLowerCase(),
            post: populatedData.post,
            reel: populatedData.reel || resolvedReel,
            pack: populatedData.pack,
            appointment: populatedData.appointment,
            ride: populatedData.ride || resolvedRide,
            route: populatedData.route || resolvedRoute,
            rideId: populatedData.rideId || resolvedRideId,
            routeId: populatedData.routeId || resolvedRouteId,
            reelId: populatedData.reelId || resolvedReelId,
            relatedId: populatedData.relatedId || resolvedReelId || resolvedRouteId || resolvedRideId,
            comment: commentId,
            text: populatedData.text || text,
            isRead: false,
            createdAt: populatedData.createdAt
        });

        // 6. Send Push Notification (if enabled)
        sendPushNotification({
            recipientUser,
            senderUser: senderUser || populatedData.sender,
            type,
            post,
            reel: resolvedReel,
            reelId: resolvedReelId,
            pack,
            appointment,
            route: resolvedRoute,
            routeId: resolvedRouteId,
            rideId: resolvedRideId
        }).catch((error) => {
            console.warn('[Notification] Push failed:', error.message);
        });

        return notification;
    } catch (error) {
        console.error('❌ [Notification] Error creating notification:', error.message);
    }
};
const VIBE_PING_TYPES = new Set(['SOS', 'HAZARD', 'SOCIAL', 'SYSTEM']);

// Admin-only dispatch endpoint for operational and safety signals.
export const sendNotificationToUser = async (req, res) => {
    try {
        const userId = String(req.body?.userId || '').trim();
        const type = String(req.body?.type || '').trim().toUpperCase();
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
        const actionUrl = typeof req.body?.actionUrl === 'string' ? req.body.actionUrl.trim() : '';

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Geçerli bir userId gerekli.' });
        }
        if (!VIBE_PING_TYPES.has(type)) {
            return res.status(400).json({ message: 'Geçersiz bildirim türü.' });
        }
        if (!title || title.length > 120 || !body || body.length > 600) {
            return res.status(400).json({ message: 'Başlık ve ileti zorunludur; başlık en fazla 120, ileti en fazla 600 karakter olabilir.' });
        }
        if (actionUrl && (actionUrl.length > 500 || !actionUrl.startsWith('/') || actionUrl.startsWith('//') || /[\u0000-\u001F]/.test(actionUrl))) {
            return res.status(400).json({ message: 'actionUrl uygulama içi bir yol olmalıdır.' });
        }

        const recipientUser = await User.findById(userId)
            .select('pushTokens notifications')
            .lean();
        if (!recipientUser) {
            return res.status(404).json({ message: 'Alıcı kullanıcı bulunamadı.' });
        }

        const notification = await Notification.create({
            recipient: recipientUser._id,
            type,
            title,
            body,
            text: body,
            actionUrl: actionUrl || undefined
        });
        const notificationData = notification.toObject({ virtuals: true });

        sendNotification(recipientUser._id, type.toLowerCase(), notificationData);

        const tokens = [...new Set((recipientUser.pushTokens || [])
            .map((entry) => entry?.token)
            .filter((token) => typeof token === 'string' && token.length > 0))];
        const push = { attempted: false, successCount: 0, failureCount: 0 };

        if (recipientUser.notifications?.pushEnabled !== false && tokens.length > 0 && admin.apps.length > 0) {
            push.attempted = true;
            try {
                const invalidTokens = [];
                for (let offset = 0; offset < tokens.length; offset += 500) {
                    const batch = tokens.slice(offset, offset + 500);
                    const result = await admin.messaging().sendEachForMulticast({
                        tokens: batch,
                        notification: { title, body },
                        data: {
                            type,
                            actionUrl,
                            title,
                            body,
                            notificationId: String(notification._id)
                        },
                        android: {
                            priority: 'high',
                            notification: {
                                channelId: 'motovibe_heads_up_channel',
                                priority: 'max',
                                sound: 'default',
                                defaultSound: true,
                                defaultVibrateTimings: true,
                                visibility: 'public'
                            }
                        },
                        apns: { payload: { aps: { sound: 'default' } } }
                    });
                    push.successCount += result.successCount;
                    push.failureCount += result.failureCount;

                    result.responses.forEach((item, index) => {
                        const code = item.error?.code || '';
                        if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
                            invalidTokens.push(batch[index]);
                        }
                    });
                }
                if (invalidTokens.length > 0) {
                    await User.updateOne(
                        { _id: recipientUser._id },
                        { $pull: { pushTokens: { token: { $in: invalidTokens } } } }
                    );
                }
            } catch (pushError) {
                push.failureCount = tokens.length - push.successCount;
                console.warn('[Vibe-Pings] FCM delivery failed:', pushError.message);
            }
        }

        return res.status(201).json({
            success: true,
            notification: notificationData,
            push
        });
    } catch (error) {
        console.error('[Vibe-Pings] Notification dispatch failed:', error);
        return res.status(500).json({ message: 'Bildirim gönderilemedi.' });
    }
};



