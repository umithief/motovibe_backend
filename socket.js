import GroupRide from './models/GroupRide.js';
import { resolveRideInviteMetadata } from './utils/rideInviteTarget.js';
import { Server } from 'socket.io';
import { getAllowedOrigins } from './config/env.js';
import User from './models/User.js';
import { verifyAccessToken } from './services/sessionTokenService.js';
import Message from './models/Message.js';
import { createMessageOnce } from './utils/chatMessageDelivery.js';
import Conversation from './models/Conversation.js';
import MeetupEvent from './models/MeetupEvent.js';
import Pack from './models/Pack.js';
import PackLoungeMessage from './models/PackLoungeMessage.js';
import mongoose from 'mongoose';
import { normalizeLegacyPackMembers } from './services/packGarageService.js';
import { initRadarSocket, startRadarBroadcastLoop } from './radarSocket.js';
import { initWebRtcSignaling } from './webrtcSignaling.js';

let io;
const userSocketMap = new Map(); // userId -> socketId
const packLoungePresence = new Map(); // packId -> Map<userId, { userId, name, avatar, connectionCount }>

const packLoungeRoom = (packId) => `pack_lounge_${packId}`;

const normalizePackId = (rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        return null;
    }
    return value;
};

const ensurePackPresenceMap = (packId) => {
    if (!packLoungePresence.has(packId)) {
        packLoungePresence.set(packId, new Map());
    }
    return packLoungePresence.get(packId);
};

const addPackPresence = (packId, socket) => {
    const members = ensurePackPresenceMap(packId);
    const userId = socket.user._id.toString();
    const current = members.get(userId);

    if (current) {
        current.connectionCount += 1;
        current.name = socket.user.name || current.name;
        current.avatar = socket.user.avatar || current.avatar;
        return;
    }

    members.set(userId, {
        userId,
        name: socket.user.name || 'Rider',
        avatar: socket.user.avatar || '',
        connectionCount: 1,
    });
};

const removePackPresence = (packId, socket) => {
    const members = packLoungePresence.get(packId);
    if (!members) return;

    const userId = socket.user._id.toString();
    const current = members.get(userId);
    if (!current) return;

    current.connectionCount -= 1;
    if (current.connectionCount <= 0) {
        members.delete(userId);
    }

    if (members.size === 0) {
        packLoungePresence.delete(packId);
    }
};

const emitPackLoungePresence = (socketServer, packId) => {
    const members = packLoungePresence.get(packId);
    const users = members
        ? [...members.values()].map((user) => ({
            userId: user.userId,
            name: user.name,
            avatar: user.avatar || '',
        }))
        : [];

    socketServer.to(packLoungeRoom(packId)).emit('pack_lounge_presence', {
        packId,
        count: users.length,
        users,
    });
};

const hasPackAccess = async (packId, userId) => {
    if (!packId || !userId) return false;

    try {
        await normalizeLegacyPackMembers();
    } catch (error) {
        console.error('hasPackAccess normalizeLegacyPackMembers error:', error);
    }

    const pack = await Pack.findOne({
        _id: packId,
        $or: [
            { owner: userId },
            { admins: userId },
            { members: userId },
            { 'members.user': userId },
        ],
    })
        .select('_id')
        .lean();

    if (pack) return true;

    if (
        !mongoose.Types.ObjectId.isValid(packId) ||
        !mongoose.Types.ObjectId.isValid(userId)
    ) {
        return false;
    }

    const packObjectId = new mongoose.Types.ObjectId(packId);
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const legacyPack = await Pack.collection.findOne(
        {
            _id: packObjectId,
            $or: [
                { owner: userObjectId },
                { admins: userObjectId },
                { 'members.user': userObjectId },
            ],
        },
        { projection: { _id: 1 } },
    );

    return Boolean(legacyPack);
};

const formatPackLoungeMessage = (messageDoc) => ({
    id: messageDoc._id.toString(),
    packId: messageDoc.pack?.toString?.() || '',
    senderId: messageDoc.sender?._id?.toString?.() || messageDoc.sender?.toString?.() || '',
    senderName: messageDoc.sender?.name || messageDoc.sender?.username || 'Rider',
    senderUsername: messageDoc.sender?.username || '',
    senderAvatar: messageDoc.sender?.avatar || '',
    type: messageDoc.type || 'TEXT',
    content: messageDoc.content || '',
    createdAt: messageDoc.createdAt?.toISOString?.() || new Date().toISOString(),
});

export const initSync = (httpServer) => {
    const allowedOrigins = getAllowedOrigins();
    const allowAllOrigins = allowedOrigins.includes('*');
    io = new Server(httpServer, {
        cors: {
            origin: allowAllOrigins ? '*' : allowedOrigins,
            methods: ["GET", "POST"],
            credentials: !allowAllOrigins
        }
    });

    // Start Radar Broadcast Loop
    startRadarBroadcastLoop(io);
    initWebRtcSignaling(io);

    // Authenticate Socket Connection
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;

            if (!token) {
                console.error('❌ [Socket Auth] No token provided for handshake');
                return next(new Error('Authentication error: No token'));
            }

            const decoded = verifyAccessToken(token);
            const user = await User.findOne({
                _id: decoded.id,
                isDeleted: { $ne: true },
            }).select('+tokenVersion');

            if (
                !user ||
                !Number.isInteger(decoded.tokenVersion) ||
                decoded.tokenVersion !== Number(user.tokenVersion || 0)
            ) {
                console.error('❌ [Socket Auth] User not found for token payload');
                return next(new Error('Authentication error'));
            }

            socket.user = user;
            const expiresInMs = (Number(decoded.exp) * 1000) - Date.now();
            socket.data.authExpiryTimer = setTimeout(() => {
                socket.emit('session_expired');
                socket.disconnect(true);
            }, Math.max(1, expiresInMs));
            next();
        } catch (err) {
            console.error('Socket Auth Error:', err.message);
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        socket.once('disconnect', () => {
            clearTimeout(socket.data.authExpiryTimer);
        });
        const userId = socket.user._id.toString();
        const username = socket.user.name;

        // 1. Map User
        userSocketMap.set(userId, socket.id);
        console.log(`⚡ Premium Rider Joined: ${username} (${userId})`);

        // 2. Broadcast Online Status
        socket.broadcast.emit('user_online', { userId });

        // Radar Initialization
        initRadarSocket(io, socket);

        // Join personal room (for DM notifications)
        socket.join(userId);
        socket.data.joinedPackLounges = new Set();

        // ------------------------------------------------------
        // 🏍️ MOTOCOMMS — Real-Time Messaging Engine
        // ------------------------------------------------------

        // Join a specific chat conversation room
        socket.on('join_chat', ({ conversationId }) => {
            if (!conversationId) return;
            socket.join(`chat_${conversationId}`);
            console.log(`💬 [MotoComms] ${username} joined chat: ${conversationId}`);
        });

        // Leave a chat room
        socket.on('leave_chat', ({ conversationId }) => {
            if (!conversationId) return;
            socket.leave(`chat_${conversationId}`);
        });

        // Send a message (saves to DB, broadcasts to room, emits ACK)
        socket.on('send_message', async (data, callback) => {
            const { conversationId, recipientId, content, type, tempId, metadata } = data || {};
            try {
                // Rate limiting (max 15 messages in 5 seconds)
                const now = Date.now();
                socket.data = socket.data || {};
                let userRate = socket.data.rateLimit;
                if (!userRate || now > userRate.resetTime) {
                    userRate = { count: 1, resetTime: now + 5000 };
                    socket.data.rateLimit = userRate;
                } else {
                    userRate.count++;
                    if (userRate.count > 15) {
                        const err = 'Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyin.';
                        socket.emit('message_send_failed', { tempId, error: err });
                        if (typeof callback === 'function') callback({ status: 'error', error: err });
                        return;
                    }
                }

                const msgType = (type || 'TEXT').toUpperCase();

                if (!content || (!conversationId && !recipientId)) {
                    const err = 'Mesaj içeriği ve alıcı zorunludur.';
                    socket.emit('message_send_failed', { tempId, error: err });
                    if (typeof callback === 'function') callback({ status: 'error', error: err });
                    return;
                }

                // 1. Block Check
                if (recipientId) {
                    const [recipientUser, senderUser] = await Promise.all([
                        User.findById(recipientId).select('blockedUsers pushTokens name notifications').lean(),
                        User.findById(userId).select('blockedUsers name username avatar').lean()
                    ]);

                    const isBlocked = (recipientUser?.blockedUsers || []).some(id => id.toString() === userId.toString()) ||
                                      (senderUser?.blockedUsers || []).some(id => id.toString() === recipientId.toString());

                    if (isBlocked) {
                        const err = 'Bu kullanıcıya mesaj gönderemezsiniz.';
                        socket.emit('message_send_failed', { tempId, error: err });
                        if (typeof callback === 'function') callback({ status: 'error', error: err });
                        return;
                    }
                }

                // 2. Find or create conversation with normalized participants
                let conversation;
                if (conversationId) {
                    conversation = await Conversation.findById(conversationId);
                }

                if (!conversation && recipientId) {
                    const normalized = Conversation.normalizeParticipants(userId, recipientId);
                    const participantsKey = Conversation.getParticipantsKey(userId, recipientId);
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
                                unreadCount: { [userId]: 0, [recipientId]: 0 }
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

                if (!conversation) {
                    const err = 'Sohbet bulunamadı.';
                    socket.emit('message_send_failed', { tempId, error: err });
                    if (typeof callback === 'function') callback({ status: 'error', error: err });
                    return;
                }

                if (conversation.isGroup || conversation.participants.length !== 2 ||
                    !conversation.participants.some(id => String(id) === String(userId)) ||
                    (recipientId && !conversation.participants.some(id => String(id) === String(recipientId)))) {
                    throw new Error('Bu sohbete mesaj gönderemezsiniz.');
                }

                // Auto-join socket to the conversation room if newly created
                socket.join(`chat_${conversation._id}`);

                // 3. Create the message
                const msgMetadata = msgType === 'RIDE_INVITE'
                    ? await resolveRideInviteMetadata(GroupRide, metadata) : (metadata || {});
                if (msgType === 'LIVE_LOCATION' && !msgMetadata.expiresAt) {
                    // 1 hour live location TTL
                    msgMetadata.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
                }

                const { message: newMessage, created } = await createMessageOnce(Message, {
                    ...(tempId != null ? { tempId } : {}),
                    conversationId: conversation._id,
                    sender: userId,
                    type: msgType,
                    content,
                    metadata: msgMetadata,
                    status: 'SENT',
                    readBy: [userId]
                });

                if (!created) {
                    const message = {
                        ...newMessage.toObject(), id: String(newMessage._id),
                        senderId: String(newMessage.sender), conversationId: String(newMessage.conversationId)
                    };
                    const ack = { tempId, messageId: message.id, conversationId: message.conversationId, message };
                    socket.emit('message_ack', ack);
                    if (typeof callback === 'function') callback({ status: 'ok', ...ack });
                    return;
                }

                // 4. Update conversation metadata
                conversation.lastMessage = newMessage._id;
                conversation.updatedAt = Date.now();
                if (conversation.deletedFor && conversation.deletedFor.length > 0) {
                    conversation.deletedFor = [];
                }

                // Increment unread for all participants except sender
                for (const pid of conversation.participants) {
                    const pidStr = pid.toString();
                    if (pidStr !== userId) {
                        const currentUnread = conversation.unreadCount.get(pidStr) || 0;
                        conversation.unreadCount.set(pidStr, currentUnread + 1);
                    }
                }
                await conversation.save();

                // 5. Build the payload
                const messagePayload = {
                    id: newMessage._id.toString(),
                    tempId: newMessage.tempId,
                    conversationId: conversation._id.toString(),
                    senderId: userId,
                    senderName: username,
                    senderAvatar: socket.user.avatar,
                    type: msgType,
                    content,
                    metadata: msgMetadata,
                    status: 'SENT',
                    createdAt: newMessage.createdAt.toISOString()
                };

                // Emit ACK to sender
                socket.emit('message_ack', {
                    tempId,
                    messageId: newMessage._id.toString(),
                    conversationId: conversation._id.toString(),
                    status: 'SENT',
                    metadata: msgMetadata,
                    createdAt: newMessage.createdAt.toISOString(),
                    message: messagePayload
                });

                if (typeof callback === 'function') {
                    callback({
                        status: 'ok',
                        messageId: newMessage._id.toString(),
                        conversationId: conversation._id.toString(),
                        message: messagePayload
                    });
                }

                // 6. Broadcast to the conversation room
                socket.to(`chat_${conversation._id}`).emit('receive_message', messagePayload);

                // 7. Direct inbox notification to other participants
                for (const pid of conversation.participants) {
                    const pidStr = pid.toString();
                    if (pidStr !== userId) {
                        io.to(pidStr).emit('new_chat_notification', {
                            conversationId: conversation._id.toString(),
                            ...messagePayload
                        });
                    }
                }

                // 8. Check delivery status (is recipient online?)
                for (const pid of conversation.participants) {
                    const pidStr = pid.toString();
                    if (pidStr !== userId && userSocketMap.has(pidStr)) {
                        newMessage.status = 'DELIVERED';
                        await newMessage.save();
                        socket.emit('message_status_update', {
                            messageId: newMessage._id.toString(),
                            conversationId: conversation._id.toString(),
                            status: 'DELIVERED'
                        });
                    }
                }

                // 9. If message is a ride invite, create inbox notification for recipients
                if (msgType === 'RIDE_INVITE') {
                    try {
                        const { createNotification } = await import('./controllers/notificationController.js');
                        const rideRef = newMessage.metadata?.rideId;
                        for (const pid of conversation.participants) {
                            const pidStr = pid.toString();
                            if (pidStr !== userId) {
                                createNotification({
                                    recipient: pidStr,
                                    sender: userId,
                                    type: 'RIDE_INVITE',
                                    ride: newMessage.metadata?.routeId || undefined,
                                    routeId: newMessage.metadata?.routeId || undefined,
                                    rideId: rideRef ? String(rideRef) : undefined,
                                    relatedId: rideRef ? String(rideRef) : undefined
                                }).catch(e => console.warn('[Socket Ride Invite Notification Error]', e.message));
                            }
                        }
                    } catch (notifErr) {
                        console.warn('[Socket Ride Invite Notification Error]', notifErr.message);
                    }
                }

            } catch (error) {
                console.error('❌ [MotoComms] send_message error:', error);
                const errMsg = error.message || 'Mesaj iletilemedi.';
                socket.emit('message_send_failed', { tempId, error: errMsg });
                if (typeof callback === 'function') callback({ status: 'error', error: errMsg });
            }
        });

        // Respond to a ride invite in real-time
        socket.on('respond_ride_invite', async (data, callback) => {
            const { messageId, action } = data || {};
            try {
                if (!messageId || !['ACCEPTED', 'DECLINED'].includes(action)) {
                    if (typeof callback === 'function') callback({ status: 'error', error: 'Geçersiz parametreler.' });
                    return;
                }
                const msg = await Message.findById(messageId);
                if (!msg || msg.type !== 'RIDE_INVITE') {
                    if (typeof callback === 'function') callback({ status: 'error', error: 'Sürüş daveti bulunamadı.' });
                    return;
                }
                const conversation = await Conversation.findOne({ _id: msg.conversationId, participants: userId });
                if (!conversation || String(msg.sender) === String(userId)) {
                    throw new Error('Bu daveti yanıtlayamazsınız.');
                }
                msg.metadata = await resolveRideInviteMetadata(GroupRide, msg.metadata);
                msg.metadata.rideStatus = action;
                await msg.save();

                const updatePayload = {
                    messageId: msg._id.toString(),
                    conversationId: msg.conversationId.toString(),
                    rideStatus: action,
                    metadata: msg.metadata
                };

                io.to(`chat_${msg.conversationId}`).emit('ride_invite_updated', updatePayload);
                io.to(`chat_${msg.conversationId}`).emit('message_updated', updatePayload);

                if (typeof callback === 'function') callback({ status: 'ok', data: updatePayload });
            } catch (e) {
                console.error('❌ [MotoComms] respond_ride_invite error:', e);
                if (typeof callback === 'function') callback({ status: 'error', error: e.message });
            }
        });

        // Typing indicators
        socket.on('typing_start', ({ conversationId }) => {
            if (!conversationId) return;
            socket.to(`chat_${conversationId}`).emit('user_typing', {
                userId,
                userName: username,
                conversationId,
                text: `${username} motorunu ısıtıyor...`
            });
        });

        socket.on('typing_stop', ({ conversationId }) => {
            if (!conversationId) return;
            socket.to(`chat_${conversationId}`).emit('user_stopped_typing', {
                userId,
                conversationId
            });
        });

        // Message read receipts
        socket.on('message_read', async ({ conversationId, messageIds }) => {
            if (!conversationId || !messageIds || !messageIds.length) return;

            try {
                // Update messages in DB
                await Message.updateMany(
                    { _id: { $in: messageIds }, sender: { $ne: userId } },
                    { $addToSet: { readBy: userId }, $set: { status: 'READ' } }
                );

                // Reset unread count for this user
                await Conversation.updateOne(
                    { _id: conversationId },
                    { $set: { [`unreadCount.${userId}`]: 0 } }
                );

                // Notify other users in the room about read status
                socket.to(`chat_${conversationId}`).emit('messages_read', {
                    userId,
                    messageIds,
                    conversationId
                });
            } catch (err) {
                console.error('❌ [MotoComms] message_read error:', err);
            }
        });

        // ------------------------------------------------------
        // 🏍️ PACK LOUNGE — Real-Time Clan Chat Engine
        // ------------------------------------------------------

        socket.on('join_pack_lounge', async (payload = {}, ack) => {
            try {
                const packId = normalizePackId(payload.packId);
                if (!packId) {
                    const response = { ok: false, message: 'Geçersiz pack kimligi.' };
                    if (typeof ack === 'function') ack(response);
                    return socket.emit('pack_lounge_error', response);
                }

                const canJoin = await hasPackAccess(packId, userId);
                if (!canJoin) {
                    const response = { ok: false, message: 'Bu Pack Lounge icin üye olmalisin.' };
                    if (typeof ack === 'function') ack(response);
                    return socket.emit('pack_lounge_error', response);
                }

                socket.join(packLoungeRoom(packId));
                socket.data.joinedPackLounges.add(packId);
                addPackPresence(packId, socket);
                emitPackLoungePresence(io, packId);

                const response = { ok: true, packId };
                if (typeof ack === 'function') ack(response);
                socket.emit('pack_lounge_joined', response);
            } catch (error) {
                console.error('join_pack_lounge error:', error);
                const response = { ok: false, message: 'Pack Lounge bağlantısi kurulamadi.' };
                if (typeof ack === 'function') ack(response);
                socket.emit('pack_lounge_error', response);
            }
        });

        socket.on('leave_pack_lounge', (payload = {}, ack) => {
            const packId = normalizePackId(payload.packId);
            if (!packId || !socket.data.joinedPackLounges.has(packId)) {
                const response = { ok: false, message: 'Aktif Pack Lounge bulunamadı.' };
                if (typeof ack === 'function') ack(response);
                return;
            }

            socket.leave(packLoungeRoom(packId));
            socket.data.joinedPackLounges.delete(packId);
            removePackPresence(packId, socket);
            emitPackLoungePresence(io, packId);

            const response = { ok: true, packId };
            if (typeof ack === 'function') ack(response);
            socket.emit('pack_lounge_left', response);
        });

        socket.on('send_pack_lounge_message', async (payload = {}, ack) => {
            try {
                const packId = normalizePackId(payload.packId);
                const content = String(payload.content || '').trim();

                if (!packId || !content) {
                    const response = { ok: false, message: 'Pack ID ve mesaj gerekli.' };
                    if (typeof ack === 'function') ack(response);
                    return socket.emit('pack_lounge_error', response);
                }

                const canSend = await hasPackAccess(packId, userId);
                if (!canSend) {
                    const response = { ok: false, message: 'Bu lounge icin yetkin yok.' };
                    if (typeof ack === 'function') ack(response);
                    return socket.emit('pack_lounge_error', response);
                }

                if (!socket.data.joinedPackLounges.has(packId)) {
                    socket.join(packLoungeRoom(packId));
                    socket.data.joinedPackLounges.add(packId);
                    addPackPresence(packId, socket);
                    emitPackLoungePresence(io, packId);
                }

                const msgType = (payload.type || 'TEXT').toString().toUpperCase();

                const saved = await PackLoungeMessage.create({
                    pack: packId,
                    sender: userId,
                    type: msgType,
                    content,
                });

                const populated = await PackLoungeMessage.findById(saved._id)
                    .populate('sender', 'name username avatar')
                    .lean();

                if (!populated) {
                    const response = { ok: false, message: 'Mesaj kaydi okunamadi.' };
                    if (typeof ack === 'function') ack(response);
                    return socket.emit('pack_lounge_error', response);
                }

                const messagePayload = formatPackLoungeMessage(populated);
                io.to(packLoungeRoom(packId)).emit('receive_pack_lounge_message', messagePayload);

                const response = { ok: true, message: messagePayload };
                if (typeof ack === 'function') ack(response);
            } catch (error) {
                console.error('send_pack_lounge_message error:', error);
                const response = { ok: false, message: 'Pack Lounge mesaji gonderilemedi.' };
                if (typeof ack === 'function') ack(response);
                socket.emit('pack_lounge_error', response);
            }
        });

        socket.on('delete_pack_lounge_message', async (payload = {}, ack) => {
            try {
                const packId = normalizePackId(payload.packId);
                const messageId = payload.messageId?.toString?.();

                if (!packId || !messageId) {
                    const response = { ok: false, message: 'Pack ID ve Message ID gerekli.' };
                    if (typeof ack === 'function') ack(response);
                    return;
                }

                const pack = await Pack.findById(packId).select('owner admins members').lean();
                if (!pack) {
                    const response = { ok: false, message: 'Klan bulunamadı.' };
                    if (typeof ack === 'function') ack(response);
                    return;
                }

                const msg = await PackLoungeMessage.findById(messageId);
                if (!msg) {
                    const response = { ok: false, message: 'Mesaj bulunamadı.' };
                    if (typeof ack === 'function') ack(response);
                    return;
                }

                const isOwner = pack.owner?.toString() === userId;
                const isAdmin = Array.isArray(pack.admins) && pack.admins.some(a => a.toString() === userId);
                const isSender = msg.sender?.toString() === userId;

                if (!isOwner && !isAdmin && !isSender) {
                    const response = { ok: false, message: 'Bu mesajı silme yetkiniz yok.' };
                    if (typeof ack === 'function') ack(response);
                    return;
                }

                await PackLoungeMessage.findByIdAndDelete(messageId);

                io.to(packLoungeRoom(packId)).emit('pack_lounge_message_deleted', {
                    packId,
                    messageId
                });

                if (typeof ack === 'function') ack({ ok: true, messageId });
            } catch (error) {
                console.error('delete_pack_lounge_message error:', error);
                if (typeof ack === 'function') ack({ ok: false, message: 'Mesaj silinemedi.' });
            }
        });

        socket.on('pack_lounge_typing_start', async (payload = {}) => {
            const packId = normalizePackId(payload.packId);
            if (!packId || !socket.data.joinedPackLounges.has(packId)) return;

            socket.to(packLoungeRoom(packId)).emit('pack_lounge_typing', {
                packId,
                userId,
                userName: username,
                isTyping: true,
            });
        });

        socket.on('pack_lounge_typing_stop', (payload = {}) => {
            const packId = normalizePackId(payload.packId);
            if (!packId || !socket.data.joinedPackLounges.has(packId)) return;

            socket.to(packLoungeRoom(packId)).emit('pack_lounge_typing', {
                packId,
                userId,
                userName: username,
                isTyping: false,
            });
        });

        // ------------------------------------------------------
        // 🏍️ LIVE RIDE TRACKING (Existing)
        // ------------------------------------------------------

        // Handled by radarSocket.js

        // ------------------------------------------------------
        // 🏢 PUBLIC ROOMS & EVENT CHAT (Existing)
        // ------------------------------------------------------

        socket.on('join_public_room', ({ room }) => {
            socket.join(room);
        });

        socket.on('leave_public_room', ({ room }) => {
            socket.leave(room);
        });

        socket.on('send_public_message', ({ room, content }) => {
            io.to(room).emit('receive_public_message', {
                userId: userId,
                userName: username,
                userAvatar: socket.user.avatar,
                text: content,
                timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
            });
        });

        socket.on('join_event_room', ({ eventId }) => {
            socket.join(`event_${eventId}`);
        });

        socket.on('leave_event_room', ({ eventId }) => {
            socket.leave(`event_${eventId}`);
        });

        socket.on('send_event_message', async ({ eventId, content }) => {
            const room = `event_${eventId}`;
            const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

            try {
                const event = await MeetupEvent.findById(eventId);
                if (event) {
                    event.messages.push({
                        id: new mongoose.Types.ObjectId().toString(),
                        userId, userName: username, text: content, time
                    });
                    await event.save();
                }
            } catch (err) {
                console.error('Error saving event message:', err);
            }

            io.to(room).emit('receive_event_message', {
                userId, userName: username, text: content, time
            });
        });

        // ------------------------------------------------------
        // 🔌 DISCONNECT
        // ------------------------------------------------------

        socket.on('disconnect', () => {
            console.log(`🚫 Rider Disconnected: ${username}`);
            userSocketMap.delete(userId);
            socket.broadcast.emit('user_offline', { userId });

            const joinedPackLounges = socket.data.joinedPackLounges;
            if (joinedPackLounges && joinedPackLounges.size > 0) {
                for (const packId of joinedPackLounges) {
                    removePackPresence(packId, socket);
                    emitPackLoungePresence(io, packId);
                }
                joinedPackLounges.clear();
            }
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};

// Helper: Send Notification via Socket
export const sendNotification = (userId, type, payload) => {
    if (!io) return;
    io.to(userId.toString()).emit('new_notification', {
        type,
        ...payload,
        timestamp: new Date()
    });
};

export const getUserSocketId = (userId) => {
    return userSocketMap.get(userId.toString());
};

export const disconnectUserSessions = (userId) => {
    if (!io || !userId) return;
    const room = userId.toString();
    io.to(room).emit('session_expired');
    io.in(room).disconnectSockets(true);

    const vibeNamespace = io.of('/vibe-comms');
    const vibeRoom = `vibe_user_${room}`;
    vibeNamespace.to(vibeRoom).emit('session_expired');
    vibeNamespace.in(vibeRoom).disconnectSockets(true);
};

