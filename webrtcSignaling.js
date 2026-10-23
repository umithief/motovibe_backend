import User from "./modules/users/model.js";
import { verifyAccessToken } from "./modules/auth/service.js";
import Pack from "./modules/packs/model.js";
import mongoose from 'mongoose';
import { normalizeLegacyPackMembers } from "./modules/packs/service.js";

const MAX_USERS_PER_CHANNEL = 8;
const channels = new Map();

const channelRoom = (channelId) => `vibe_channel_${channelId}`;
const userRoom = (userId) => `vibe_user_${userId}`;
const packChannelPrefix = 'pack_';

const sanitizeChannelId = (rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value) return null;
    if (value.length < 3 || value.length > 48) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null;
    return value;
};

const extractPackIdFromChannel = (channelId) => {
    if (!channelId || !channelId.startsWith(packChannelPrefix)) {
        return null;
    }
    const rawPackId = channelId.slice(packChannelPrefix.length);
    if (!mongoose.Types.ObjectId.isValid(rawPackId)) {
        return null;
    }
    return rawPackId;
};

const isPackMember = async ({ packId, userId }) => {
    if (!packId || !userId) return false;

    try {
        await normalizeLegacyPackMembers();
    } catch (error) {
        console.error('[VibeComms] normalizeLegacyPackMembers error:', error);
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

const getAuthToken = (socket) => {
    if (socket?.handshake?.auth?.token) return socket.handshake.auth.token;
    if (socket?.handshake?.query?.token) return socket.handshake.query.token;
    const headerToken = socket?.handshake?.headers?.authorization;
    if (!headerToken) return null;
    if (headerToken.startsWith('Bearer ')) {
        return headerToken.slice(7);
    }
    return headerToken;
};

const getOrCreateChannel = (channelId, creatorId) => {
    if (!channels.has(channelId)) {
        channels.set(channelId, {
            channelId,
            creatorId,
            members: new Map(),
        });
    }
    return channels.get(channelId);
};

const mapMember = (member) => ({
    userId: member.userId,
    name: member.name,
    avatar: member.avatar || null,
    isMuted: Boolean(member.isMuted),
    isSpeaking: Boolean(member.isSpeaking),
});

const listChannelUsers = (channel) => {
    return [...channel.members.values()].map(mapMember);
};

const emitChannelUsers = (namespace, channelId) => {
    const channel = channels.get(channelId);
    if (!channel) return;

    namespace.to(channelRoom(channelId)).emit('channel-users', {
        channelId,
        maxUsers: MAX_USERS_PER_CHANNEL,
        creatorId: channel.creatorId,
        users: listChannelUsers(channel),
    });
};

const emitError = (socket, code, message, ack) => {
    const payload = { code, message };
    socket.emit('vibe-error', payload);
    if (typeof ack === 'function') {
        ack({ ok: false, ...payload });
    }
};

const removeFromChannel = ({ namespace, socket, reason = 'left' }) => {
    const channelId = socket.data?.vibeChannelId;
    if (!channelId) return;

    const channel = channels.get(channelId);
    if (!channel) {
        socket.data.vibeChannelId = null;
        return;
    }

    const member = channel.members.get(socket.user.id);
    channel.members.delete(socket.user.id);
    socket.leave(channelRoom(channelId));
    socket.data.vibeChannelId = null;

    if (channel.members.size === 0) {
        channels.delete(channelId);
        return;
    }

    if (channel.creatorId === socket.user.id) {
        channel.creatorId = [...channel.members.keys()][0];
    }

    namespace.to(channelRoom(channelId)).emit('participant-left', {
        channelId,
        userId: socket.user.id,
        name: member?.name || socket.user.name,
        reason,
        creatorId: channel.creatorId,
    });
    emitChannelUsers(namespace, channelId);
};

export const initWebRtcSignaling = (io) => {
    const namespace = io.of('/vibe-comms');

    namespace.use(async (socket, next) => {
        try {
            const token = getAuthToken(socket);
            if (!token) {
                return next(new Error('Authentication error: token missing'));
            }

            const decoded = verifyAccessToken(token);
            const user = await User.findOne({
                _id: decoded.id,
                isDeleted: { $ne: true },
            })
                .select('+tokenVersion name avatar isPro isPremium')
                .lean();

            if (
                !user ||
                !Number.isInteger(decoded.tokenVersion) ||
                decoded.tokenVersion !== Number(user.tokenVersion || 0)
            ) {
                return next(new Error('Authentication error: user not found'));
            }

            socket.user = {
                id: user._id.toString(),
                name: user.name,
                avatar: user.avatar || null,
                isApex: Boolean(user.isPro || user.isPremium),
            };
            const expiresInMs = (Number(decoded.exp) * 1000) - Date.now();
            socket.data.authExpiryTimer = setTimeout(() => {
                socket.emit('session_expired');
                socket.disconnect(true);
            }, Math.max(1, expiresInMs));

            next();
        } catch (error) {
            console.error('[VibeComms] auth failed:', error.message);
            next(new Error('Authentication error'));
        }
    });

    namespace.on('connection', (socket) => {
        socket.once('disconnect', () => {
            clearTimeout(socket.data.authExpiryTimer);
        });
        socket.join(userRoom(socket.user.id));
        socket.emit('comms-ready', { userId: socket.user.id });

        socket.on('join-channel', async (payload = {}, ack) => {
            try {
                const channelId = sanitizeChannelId(payload.channelId);
                if (!channelId) {
                    return emitError(socket, 'INVALID_CHANNEL', 'Geçersiz kanal ID.', ack);
                }

                const packId = extractPackIdFromChannel(channelId);
                if (packId) {
                    const memberAccess = await isPackMember({
                        packId,
                        userId: socket.user.id,
                    });
                    if (!memberAccess) {
                        return emitError(
                            socket,
                            'PACK_MEMBER_REQUIRED',
                            'Bu voice lounge kanalina katilmak icin pack uyesi olmalisin.',
                            ack,
                        );
                    }
                }

                if (socket.data?.vibeChannelId && socket.data.vibeChannelId !== channelId) {
                    removeFromChannel({ namespace, socket, reason: 'switch' });
                }

                let channel = channels.get(channelId);
                if (!channel) {
                    const canCreatePackChannel = Boolean(packId);
                    if (!socket.user.isApex && !canCreatePackChannel) {
                        return emitError(
                            socket,
                            'APEX_REQUIRED',
                            'Kanal oluşturmak icin APEX üyeliği gerekli.',
                            ack,
                        );
                    }
                    channel = getOrCreateChannel(channelId, socket.user.id);
                }

                const isAlreadyMember = channel.members.has(socket.user.id);
                if (!isAlreadyMember && channel.members.size >= MAX_USERS_PER_CHANNEL) {
                    return emitError(socket, 'ROOM_FULL', 'Bu kanal dolu (8/8).', ack);
                }

                const room = channelRoom(channelId);
                socket.join(room);
                socket.data.vibeChannelId = channelId;

                channel.members.set(socket.user.id, {
                    userId: socket.user.id,
                    name: socket.user.name,
                    avatar: socket.user.avatar,
                    socketId: socket.id,
                    isMuted: false,
                    isSpeaking: false,
                });

                emitChannelUsers(namespace, channelId);

                socket.to(room).emit('participant-joined', {
                    channelId,
                    user: mapMember(channel.members.get(socket.user.id)),
                });

                socket.emit('channel-joined', {
                    ok: true,
                    channelId,
                    userId: socket.user.id,
                    maxUsers: MAX_USERS_PER_CHANNEL,
                    creatorId: channel.creatorId,
                    users: listChannelUsers(channel),
                });

                if (typeof ack === 'function') {
                    ack({ ok: true, channelId, creatorId: channel.creatorId });
                }
            } catch (error) {
                console.error('[VibeComms] join-channel error:', error);
                emitError(socket, 'JOIN_FAILED', 'Kanala bağlanırken hata oluştu.', ack);
            }
        });

        socket.on('offer', (payload = {}) => {
            const channelId = sanitizeChannelId(payload.channelId);
            const targetUserId = String(payload.targetUserId || '').trim();
            const sdp = payload.sdp;

            if (!channelId || !targetUserId || !sdp) return;
            const channel = channels.get(channelId);
            if (!channel || !channel.members.has(socket.user.id) || !channel.members.has(targetUserId)) return;

            namespace.to(userRoom(targetUserId)).emit('offer', {
                channelId,
                fromUserId: socket.user.id,
                fromName: socket.user.name,
                sdp,
            });
        });

        socket.on('answer', (payload = {}) => {
            const channelId = sanitizeChannelId(payload.channelId);
            const targetUserId = String(payload.targetUserId || '').trim();
            const sdp = payload.sdp;

            if (!channelId || !targetUserId || !sdp) return;
            const channel = channels.get(channelId);
            if (!channel || !channel.members.has(socket.user.id) || !channel.members.has(targetUserId)) return;

            namespace.to(userRoom(targetUserId)).emit('answer', {
                channelId,
                fromUserId: socket.user.id,
                fromName: socket.user.name,
                sdp,
            });
        });

        socket.on('ice-candidate', (payload = {}) => {
            const channelId = sanitizeChannelId(payload.channelId);
            const targetUserId = String(payload.targetUserId || '').trim();
            const candidate = payload.candidate;

            if (!channelId || !targetUserId || !candidate) return;
            const channel = channels.get(channelId);
            if (!channel || !channel.members.has(socket.user.id) || !channel.members.has(targetUserId)) return;

            namespace.to(userRoom(targetUserId)).emit('ice-candidate', {
                channelId,
                fromUserId: socket.user.id,
                candidate,
            });
        });

        socket.on('mute-state', (payload = {}) => {
            const channelId = sanitizeChannelId(payload.channelId || socket.data?.vibeChannelId);
            if (!channelId) return;

            const channel = channels.get(channelId);
            const member = channel?.members.get(socket.user.id);
            if (!member) return;

            member.isMuted = Boolean(payload.isMuted);
            namespace.to(channelRoom(channelId)).emit('mute-state', {
                channelId,
                userId: socket.user.id,
                isMuted: member.isMuted,
            });
        });

        socket.on('speaking-state', (payload = {}) => {
            const channelId = sanitizeChannelId(payload.channelId || socket.data?.vibeChannelId);
            if (!channelId) return;

            const channel = channels.get(channelId);
            const member = channel?.members.get(socket.user.id);
            if (!member) return;

            member.isSpeaking = Boolean(payload.isSpeaking);
            namespace.to(channelRoom(channelId)).emit('speaking-state', {
                channelId,
                userId: socket.user.id,
                isSpeaking: member.isSpeaking,
            });
        });

        socket.on('leave-channel', (payload = {}) => {
            if (payload.channelId && payload.channelId !== socket.data?.vibeChannelId) return;
            removeFromChannel({ namespace, socket, reason: 'left' });
            socket.emit('channel-left', { ok: true });
        });

        socket.on('disconnect', () => {
            removeFromChannel({ namespace, socket, reason: 'disconnect' });
        });
    });

    return namespace;
};
