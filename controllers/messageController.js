import GroupRide from '../models/GroupRide.js';
import { resolveRideInviteMetadata } from '../utils/rideInviteTarget.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/appError.js';
import admin from 'firebase-admin';
import { createMessageOnce } from '../utils/chatMessageDelivery.js';
import { createNotification } from './notificationController.js';

// Helper to push chat FCM notification
const sendChatPushNotification = async ({ recipientUser, senderUser, conversationId, content, type }) => {
    if (!admin.apps.length || !recipientUser) return;
    if (recipientUser.notifications?.pushEnabled === false) return;

    const tokens = (recipientUser.pushTokens || []).map((entry) => entry.token).filter(Boolean);
    if (tokens.length === 0) return;

    let bodyText = content || 'Yeni bir mesajın var.';
    if (type === 'IMAGE') bodyText = '📷 Fotoğraf';
    else if (type === 'VOICE') bodyText = '🎙️ Sesli Mesaj';
    else if (type === 'ROUTE_SHARE') bodyText = '🗺️ Rota Paylaşımı';
    else if (type === 'LIVE_LOCATION') bodyText = '📍 Canlı Konum';
    else if (type === 'RIDE_INVITE') bodyText = '🏍️ Sürüş Daveti';
    else if (type === 'MOTOMOJI') bodyText = '⚡ MotoMoji';

    try {
        const response = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: {
                title: senderUser?.name || 'Yeni Mesaj',
                body: bodyText
            },
            data: {
                type: 'chat',
                conversationId: conversationId ? String(conversationId) : '',
                senderId: senderUser?._id ? String(senderUser._id) : '',
                senderName: senderUser?.name || '',
                route: 'motocomms'
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
        console.warn('[Chat Push] Error sending notification:', err.message);
    }
};

// @desc    Get all conversation threads for current user with pagination & totalUnread
// @route   GET /api/messages/threads
// @access  Private
export const getThreads = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const baseFilter = {
        participants: userId,
        deletedFor: { $ne: userId }
    };

    const conversations = await Conversation.find(baseFilter)
        .populate({
            path: 'participants',
            select: 'name username avatar isFounder isVerified'
        })
        .populate({
            path: 'lastMessage',
            select: 'content type sender createdAt status readBy'
        })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit);

    const totalThreads = await Conversation.countDocuments(baseFilter);
    const hasMore = skip + conversations.length < totalThreads;

    // Calculate total unread across all active threads for the user (lean projection for performance)
    const allUserConvs = await Conversation.find(baseFilter).select('unreadCount').lean();
    const totalUnread = allUserConvs.reduce((acc, conv) => {
        const unreadVal = conv.unreadCount?.[userId.toString()] ?? 0;
        return acc + (Number(unreadVal) || 0);
    }, 0);

    const cleanAvatar = (url) => {
        if (!url) return '';
        if (typeof url === 'string' && url.startsWith('data:')) return '';
        return url;
    };

    // Format for frontend
    const threads = conversations.map(conv => {
        const otherParticipant = conv.participants.find(p => p._id.toString() !== userId.toString());
        const isMuted = Array.isArray(conv.isMutedBy) && conv.isMutedBy.some(id => id.toString() === userId.toString());
        const unread = conv.unreadCount?.get?.(userId.toString()) ?? conv.unreadCount?.[userId.toString()] ?? 0;

        return {
            id: conv._id,
            isGroup: conv.isGroup,
            groupName: conv.groupName,
            isMuted,
            user: otherParticipant ? {
                id: otherParticipant._id,
                name: otherParticipant.name,
                username: otherParticipant.username,
                avatar: cleanAvatar(otherParticipant.avatar),
                isFounder: otherParticipant.isFounder || false,
                isVerified: otherParticipant.isVerified || false
            } : { name: 'Sürücü', avatar: '' },
            lastMessage: conv.lastMessage ? {
                content: conv.lastMessage.content,
                type: conv.lastMessage.type || 'TEXT',
                senderId: conv.lastMessage.sender,
                createdAt: conv.lastMessage.createdAt,
                status: conv.lastMessage.status || 'SENT',
                read: Array.isArray(conv.lastMessage.readBy) && conv.lastMessage.readBy.some(id => id.toString() === userId.toString())
            } : null,
            unreadCount: Number(unread) || 0
        };
    });

    // Deduplicate threads by remote user ID in case of historical duplicate docs
    const seenUsers = new Set();
    const uniqueThreads = threads.filter(thread => {
        if (!thread.user || !thread.user.id) return true;
        const otherId = String(thread.user.id);
        if (seenUsers.has(otherId)) return false;
        seenUsers.add(otherId);
        return true;
    });

    res.status(200).json({
        status: 'success',
        data: {
            threads: uniqueThreads,
            totalUnread,
            unreadCount: totalUnread,
            hasMore,
            total: totalThreads,
            page,
            limit
        }
    });
});

// @desc    Get total unread chat messages count
// @route   GET /api/messages/unread-count
// @access  Private
export const getUnreadCount = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const allUserConvs = await Conversation.find({ 
        participants: userId, 
        deletedFor: { $ne: userId } 
    }).select('unreadCount').lean();
    
    const totalUnread = allUserConvs.reduce((acc, conv) => {
        const unreadVal = conv.unreadCount?.[userId.toString()] ?? 0;
        return acc + (Number(unreadVal) || 0);
    }, 0);

    res.status(200).json({
        status: 'success',
        data: {
            unreadCount: totalUnread,
            totalUnread,
            count: totalUnread
        }
    });
});

// @desc    Get messages for a specific conversation
// @route   GET /api/messages/conversation/:userId
// @access  Private
export const getConversation = catchAsync(async (req, res, next) => {
    const currentUserId = req.user.id;
    const otherUserId = req.params.userId;

    // Normalize 1-1 participants query
    const normalized = Conversation.normalizeParticipants(currentUserId, otherUserId);
    let conversation = await Conversation.findOne({
        participants: normalized,
        isGroup: false
    });

    if (!conversation) {
        // Fallback search with $all
        conversation = await Conversation.findOne({
            participants: { $all: [currentUserId, otherUserId] },
            isGroup: false
        });
    }

    if (!conversation) {
        return res.status(200).json({
            status: 'success',
            data: { messages: [], conversationId: null, hasMore: false }
        });
    }

    // Reset unread count for current user
    const currentUnread = conversation.unreadCount.get(currentUserId.toString()) || 0;
    if (currentUnread > 0) {
        conversation.unreadCount.set(currentUserId.toString(), 0);
        await conversation.save();
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const messageFilter = {
        conversationId: conversation._id,
        deletedFor: { $ne: currentUserId }
    };

    let messages = await Message.find(messageFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    // Reverse to send oldest first (chat standard)
    messages = messages.reverse();

    const totalMessages = await Message.countDocuments(messageFilter);
    const hasMore = skip + messages.length < totalMessages;

    res.status(200).json({
        status: 'success',
        data: {
            messages: messages.map(m => ({
                id: m._id,
                tempId: m.tempId,
                conversationId: conversation._id,
                senderId: m.sender,
                type: m.type || 'TEXT',
                content: m.content,
                metadata: m.metadata || {},
                status: m.status || 'SENT',
                createdAt: m.createdAt,
                read: Array.isArray(m.readBy) && m.readBy.some(id => id.toString() === currentUserId.toString())
            })),
            conversationId: conversation._id,
            hasMore
        }
    });
});

// @desc    Send a message (HTTP endpoint)
const userHttpMsgRateMap = new Map();

// @desc    Send a message (HTTP fallback)
// @route   POST /api/messages
// @access  Private
export const sendMessage = catchAsync(async (req, res, next) => {
    const { recipientId, content, type, conversationId: requestedConvId, metadata, tempId } = req.body;
    const senderId = req.user.id;
    const msgType = (type || 'TEXT').toUpperCase();

    // 0. Rate limiting (max 15 messages per 5 seconds)
    const now = Date.now();
    let userRate = userHttpMsgRateMap.get(senderId.toString());
    if (!userRate || now > userRate.resetTime) {
        userRate = { count: 1, resetTime: now + 5000 };
        userHttpMsgRateMap.set(senderId.toString(), userRate);
    } else {
        userRate.count++;
        if (userRate.count > 15) {
            return next(new AppError('Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyin.', 429));
        }
    }

    if (!recipientId || !content) {
        return next(new AppError('Alıcı ve mesaj içeriği zorunludur.', 400));
    }

    if (recipientId.toString() === senderId.toString()) {
        return next(new AppError('Kendinize mesaj gönderemezsiniz.', 400));
    }

    // 1. Block Check
    const [recipientUser, senderUser] = await Promise.all([
        User.findById(recipientId).select('blockedUsers pushTokens name notifications').lean(),
        User.findById(senderId).select('blockedUsers name username avatar').lean()
    ]);

    if (!recipientUser) {
        return next(new AppError('Alıcı kullanıcı bulunamadı.', 404));
    }

    const isBlocked = (recipientUser.blockedUsers || []).some(id => id.toString() === senderId.toString()) ||
                      (senderUser?.blockedUsers || []).some(id => id.toString() === recipientId.toString());

    if (isBlocked) {
        return next(new AppError('Bu kullanıcıya mesaj gönderemezsiniz.', 403));
    }

    // 2. Find or Create Normalized 1-1 Conversation
    let conversation;
    if (requestedConvId) {
        conversation = await Conversation.findById(requestedConvId);
    }

    if (!conversation) {
        const normalized = Conversation.normalizeParticipants(senderId, recipientId);
        const participantsKey = Conversation.getParticipantsKey(senderId, recipientId);
        conversation = await Conversation.findOne({
            $or: [
                { participantsKey },
                { participants: normalized, isGroup: false }
            ]
        });

        if (!conversation) {
            try {
                conversation = await Conversation.create({
                    participants: normalized,
                    participantsKey,
                    isGroup: false,
                    unreadCount: {
                        [senderId]: 0,
                        [recipientId]: 0
                    }
                });
            } catch (err) {
                if (err.code === 11000) {
                    conversation = await Conversation.findOne({ participantsKey });
                } else {
                    throw err;
                }
            }
        }
    }

    if (conversation.isGroup || conversation.participants.length !== 2 ||
        !conversation.participants.some(id => String(id) === String(senderId)) ||
        !conversation.participants.some(id => String(id) === String(recipientId))) {
        return next(new AppError('Bu sohbete mesaj gönderemezsiniz.', 403));
    }

    // 3. Create message
    const msgMetadata = msgType === 'RIDE_INVITE'
        ? await resolveRideInviteMetadata(GroupRide, metadata) : (metadata || {});
    if (msgType === 'LIVE_LOCATION' && !msgMetadata.expiresAt) {
        // Default TTL: 1 hour
        msgMetadata.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    }

    const { message: newMessage, created } = await createMessageOnce(Message, {
        ...(tempId != null ? { tempId } : {}),
        conversationId: conversation._id,
        sender: senderId,
        type: msgType,
        content,
        metadata: msgMetadata,
        status: 'SENT',
        readBy: [senderId]
    });

    if (!created) {
        return res.status(200).json({ status: 'success', data: {
            message: newMessage, conversationId: conversation._id
        } });
    }

    // 4. Update conversation metadata & unread
    conversation.lastMessage = newMessage._id;
    conversation.updatedAt = Date.now();

    // If conversation was deleted for either party, un-delete it
    if (conversation.deletedFor && conversation.deletedFor.length > 0) {
        conversation.deletedFor = [];
    }

    const currentUnread = conversation.unreadCount.get(recipientId.toString()) || 0;
    conversation.unreadCount.set(recipientId.toString(), currentUnread + 1);

    await conversation.save();

    // 5. Socket Notification
    try {
        const { getIO } = await import('../socket.js');
        const io = getIO();

        const messagePayload = {
            id: newMessage._id.toString(),
            tempId: newMessage.tempId,
            conversationId: conversation._id.toString(),
            senderId,
            senderName: senderUser?.name || 'Sürücü',
            senderAvatar: senderUser?.avatar || '',
            type: msgType,
            content,
            metadata: newMessage.metadata,
            status: 'SENT',
            createdAt: newMessage.createdAt.toISOString()
        };

        io.to(`chat_${conversation._id}`).emit('receive_message', messagePayload);
        io.to(recipientId.toString()).emit('new_chat_notification', messagePayload);
    } catch (err) {
        console.warn('Socket notification failed in HTTP sendMessage', err.message);
    }

    // 6. Push Notification (if not muted)
    const isMuted = (conversation.isMutedBy || []).some(id => id.toString() === recipientId.toString());
    if (!isMuted) {
        sendChatPushNotification({
            recipientUser,
            senderUser,
            conversationId: conversation._id,
            content,
            type: msgType
        }).catch(e => console.warn('[Chat Push Error]', e.message));
    }

    // 7. Sürüş Daveti için Notification Inbox kaydı oluştur
    if (msgType === 'RIDE_INVITE') {
        try {
            const rideRef = newMessage.metadata?.rideId;
            createNotification({
                recipient: recipientId,
                sender: senderId,
                type: 'RIDE_INVITE',
                ride: newMessage.metadata?.routeId || undefined,
                routeId: newMessage.metadata?.routeId || undefined,
                rideId: rideRef ? String(rideRef) : undefined,
                relatedId: rideRef ? String(rideRef) : undefined
            }).catch(e => console.warn('[Ride Invite Notification Error]', e.message));
        } catch (err) {
            console.warn('[Ride Invite Notification Error]', err.message);
        }
    }

    res.status(201).json({
        status: 'success',
        data: {
            message: newMessage,
            conversationId: conversation._id
        }
    });
});

// @desc    Toggle mute/unmute conversation (idempotent when requested state provided)
// @route   PUT /api/messages/conversation/:conversationId/mute
// @access  Private
export const toggleMuteConversation = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { isMuted: requestedMute, muted } = req.body || {};

    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId
    });

    if (!conversation) {
        return next(new AppError('Sohbet bulunamadı.', 404));
    }

    const currentMuted = (conversation.isMutedBy || []).some(id => id.toString() === userId.toString());
    const shouldMute = typeof requestedMute === 'boolean'
        ? requestedMute
        : (typeof muted === 'boolean' ? muted : !currentMuted);

    if (shouldMute) {
        await Conversation.updateOne(
            { _id: conversationId },
            { $addToSet: { isMutedBy: userId } }
        );
    } else {
        await Conversation.updateOne(
            { _id: conversationId },
            { $pull: { isMutedBy: userId } }
        );
    }

    res.status(200).json({
        status: 'success',
        data: { isMuted: shouldMute }
    });
});

// @desc    Mark conversation as read for current user
// @route   PUT /api/messages/conversation/:conversationId/read
// @access  Private
export const markConversationAsRead = catchAsync(async (req, res, next) => {
    const currentUserId = req.user.id;
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: currentUserId
    });

    if (conversation) {
        conversation.unreadCount.set(currentUserId.toString(), 0);
        await conversation.save();

        await Message.updateMany(
            { conversationId, readBy: { $ne: currentUserId } },
            { $addToSet: { readBy: currentUserId }, $set: { status: 'READ' } }
        );
    }

    res.status(200).json({
        status: 'success',
        message: 'Sohbet okundu olarak işaretlendi.'
    });
});

// @desc    Delete / hide conversation for user
// @route   DELETE /api/messages/conversation/:conversationId
// @access  Private
export const deleteConversation = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId
    });

    if (!conversation) {
        return next(new AppError('Sohbet bulunamadı.', 404));
    }

    await Conversation.updateOne(
        { _id: conversationId },
        { $addToSet: { deletedFor: userId } }
    );

    // Also hide existing messages
    await Message.updateMany(
        { conversationId },
        { $addToSet: { deletedFor: userId } }
    );

    res.status(200).json({
        status: 'success',
        message: 'Sohbet silindi.'
    });
});

// @desc    Delete single message for user
// @route   DELETE /api/messages/:messageId
// @access  Private
export const deleteMessage = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
        return next(new AppError('Mesaj bulunamadı.', 404));
    }

    await Message.updateOne(
        { _id: messageId },
        { $addToSet: { deletedFor: userId } }
    );

    res.status(200).json({
        status: 'success',
        message: 'Mesaj silindi.'
    });
});

// @desc    Respond to a ride invite (ACCEPT / DECLINE)
// @route   PUT /api/messages/:messageId/ride-action
// @access  Private
export const respondRideInvite = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { action } = req.body;

    if (!['ACCEPTED', 'DECLINED'].includes(action)) {
        return next(new AppError('Geçersiz aksiyon. ACCEPTED veya DECLINED olmalıdır.', 400));
    }

    const message = await Message.findById(messageId).populate('sender', 'name username avatar');
    if (!message) {
        return next(new AppError('Mesaj bulunamadı.', 404));
    }

    if (message.type !== 'RIDE_INVITE') {
        return next(new AppError('Bu mesaj bir sürüş daveti değil.', 400));
    }

    const conversation = await Conversation.findOne({ _id: message.conversationId, participants: userId });
    if (!conversation || String(message.sender._id) === String(userId)) {
        return next(new AppError('Bu daveti yanıtlayamazsınız.', 403));
    }

    message.metadata = await resolveRideInviteMetadata(GroupRide, message.metadata);
    message.metadata.rideStatus = action;
    await message.save();

    try {
        const { getIO } = await import('../socket.js');
        getIO().to(`chat_${message.conversationId}`).emit('message_updated', {
            messageId: message._id.toString(),
            conversationId: message.conversationId.toString(),
            metadata: message.metadata
        });
    } catch (error) {
        console.warn('Ride invite update notification failed:', error.message);
    }

    res.status(200).json({
        status: 'success',
        data: {
            messageId: message._id,
            rideStatus: action,
            message
        }
    });
});

// @desc    Get all pack lounges for current user with latest message
// @route   GET /api/messages/lounges
// @access  Private
export const getMyPackLounges = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const Pack = (await import('../models/Pack.js')).default;
    const PackLoungeMessage = (await import('../models/PackLoungeMessage.js')).default;

    const packs = await Pack.find({
        isDeleted: { $ne: true },
        $or: [
            { owner: userId },
            { admins: userId },
            { members: userId }
        ]
    }).select('name avatar cover members admins owner isPrivate city description').lean();

    const loungeThreads = await Promise.all(packs.map(async (pack) => {
        const lastMsg = await PackLoungeMessage.findOne({ pack: pack._id })
            .sort({ createdAt: -1 })
            .populate('sender', 'name username avatar')
            .lean();

        const memberCount = (pack.members?.length || 0) + (pack.admins?.length || 0) + (pack.owner ? 1 : 0);

        return {
            id: pack._id.toString(),
            packId: pack._id.toString(),
            name: pack.name,
            avatar: pack.avatar || pack.cover || '',
            description: pack.description || '',
            city: pack.city || '',
            memberCount,
            isPrivate: Boolean(pack.isPrivate),
            lastMessage: lastMsg ? {
                id: lastMsg._id.toString(),
                senderId: lastMsg.sender?._id?.toString() || '',
                senderName: lastMsg.sender?.name || lastMsg.sender?.username || 'Sürücü',
                senderAvatar: lastMsg.sender?.avatar || '',
                content: lastMsg.content || '',
                type: lastMsg.type || 'TEXT',
                createdAt: lastMsg.createdAt?.toISOString() || new Date().toISOString()
            } : null,
            updatedAt: lastMsg?.createdAt || pack.updatedAt || pack.createdAt
        };
    }));

    loungeThreads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.status(200).json({
        status: 'success',
        data: { lounges: loungeThreads }
    });
});
