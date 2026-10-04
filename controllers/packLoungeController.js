import mongoose from 'mongoose';

import Pack from '../models/Pack.js';
import PackLoungeMessage from '../models/PackLoungeMessage.js';
import User from '../models/User.js';
import { isApprovedMember } from '../utils/packMembership.js';

const isValidObjectId = (value = '') => mongoose.Types.ObjectId.isValid(value);

const toMessagePayload = (message) => ({
    id: message._id.toString(),
    packId: message.pack?.toString?.() || '',
    senderId: message.sender?._id?.toString?.() || message.sender?.toString?.() || '',
    senderName: message.sender?.name || message.sender?.username || 'Rider',
    senderUsername: message.sender?.username || '',
    senderAvatar: message.sender?.avatar || '',
    type: message.type || 'TEXT',
    content: message.content || '',
    createdAt: message.createdAt?.toISOString?.() || new Date().toISOString(),
});

const canAccessPack = async (packId, userId) => {
    if (!packId || !userId) return false;

    const pack = await Pack.findById(packId)
        .select('isDeleted memberRoles owner admins members joinRequests')
        .lean();
    return Boolean(pack && !pack.isDeleted && isApprovedMember(pack, userId));
};

// @desc    Get pack lounge messages
// @route   GET /api/packs/:packId/lounge/messages
// @access  Private (approved pack members)
export const getPackLoungeMessages = async (req, res) => {
    try {
        const { packId } = req.params;
        if (!isValidObjectId(packId)) {
            return res.status(400).json({ message: 'Geçersiz klan kimliği.' });
        }

        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });
        }

        if (!(await canAccessPack(packId, userId))) {
            return res.status(403).json({ message: 'Lounge yalnızca onaylı üyelere açıktır.' });
        }

        const parsedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isFinite(parsedLimit)
            ? Math.min(80, Math.max(1, parsedLimit))
            : 50;
        const before = req.query.before?.toString().trim();
        const query = { pack: packId };

        if (before) {
            const beforeDate = new Date(before);
            if (!Number.isNaN(beforeDate.getTime())) {
                query.createdAt = { $lt: beforeDate };
            }
        }

        const messages = await PackLoungeMessage.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('sender', 'name username avatar')
            .lean();

        res.status(200).json({
            messages: messages.reverse().map(toMessagePayload),
            hasMore: messages.length >= limit,
        });
    } catch (error) {
        console.error('getPackLoungeMessages error:', error);
        res.status(500).json({ message: 'Lounge mesajları alınamadı.' });
    }
};

// @desc    Send a pack lounge message (HTTP fallback)
// @route   POST /api/packs/:packId/lounge/messages
// @access  Private (approved pack members)
export const postPackLoungeMessage = async (req, res) => {
    try {
        const { packId } = req.params;
        if (!isValidObjectId(packId)) {
            return res.status(400).json({ message: 'Geçersiz klan kimliği.' });
        }

        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });
        }

        const content = req.body?.content?.toString?.().trim?.() || '';
        const msgType = (req.body?.type || 'TEXT').toString().toUpperCase();

        if (!content) {
            return res.status(400).json({ message: 'Mesaj içeriği boş olamaz.' });
        }
        if (content.length > 4000) {
            return res.status(400).json({ message: 'Mesaj en fazla 4000 karakter olabilir.' });
        }

        if (!(await canAccessPack(packId, userId))) {
            return res.status(403).json({ message: 'Lounge yalnızca onaylı üyelere açıktır.' });
        }

        const created = await PackLoungeMessage.create({
            pack: packId,
            sender: userId,
            type: msgType,
            content,
        });
        const populated = await PackLoungeMessage.findById(created._id)
            .populate('sender', 'name username avatar')
            .lean();

        if (!populated) {
            return res.status(500).json({ message: 'Mesaj kaydedildi ancak okunamadı.' });
        }
        res.status(201).json({ message: toMessagePayload(populated) });
    } catch (error) {
        console.error('postPackLoungeMessage error:', error);
        res.status(500).json({ message: 'Lounge mesajı gönderilemedi.' });
    }
};

// @desc    Delete a pack lounge message
// @route   DELETE /api/packs/:packId/lounge/messages/:messageId
// @access  Private (approved pack members: author, admin, owner)
export const deletePackLoungeMessage = async (req, res) => {
    try {
        const { packId, messageId } = req.params;
        if (!isValidObjectId(packId) || !isValidObjectId(messageId)) {
            return res.status(400).json({ message: 'Geçersiz kimlik.' });
        }

        const userId = req.user?._id?.toString?.() || req.user?.id?.toString?.();
        if (!userId) {
            return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });
        }

        const pack = await Pack.findById(packId).select('owner admins members').lean();
        if (!pack) {
            return res.status(404).json({ message: 'Klan bulunamadı.' });
        }

        const msg = await PackLoungeMessage.findById(messageId);
        if (!msg) {
            return res.status(404).json({ message: 'Mesaj bulunamadı.' });
        }

        const isOwner = pack.owner?.toString() === userId;
        const isAdmin = Array.isArray(pack.admins) && pack.admins.some(a => a.toString() === userId);
        const isSender = msg.sender?.toString() === userId;

        if (!isOwner && !isAdmin && !isSender) {
            return res.status(403).json({ message: 'Bu mesajı silme yetkiniz yok.' });
        }

        await PackLoungeMessage.findByIdAndDelete(messageId);

        if (global.io) {
            global.io.to(`pack_lounge_${packId}`).emit('pack_lounge_message_deleted', {
                packId,
                messageId
            });
        }

        res.status(200).json({ status: 'success', message: 'Mesaj silindi.', messageId });
    } catch (error) {
        console.error('deletePackLoungeMessage error:', error);
        res.status(500).json({ message: 'Lounge mesajı silinemedi.' });
    }
};

// @desc    Toggle lounge mute for current user
// @route   POST /api/packs/:packId/lounge/mute
// @access  Private
export const togglePackLoungeMute = async (req, res) => {
    try {
        const { packId } = req.params;
        const userId = req.user?._id || req.user?.id;
        if (!userId || !isValidObjectId(packId)) {
            return res.status(400).json({ message: 'Geçersiz istek.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });

        const { muted } = req.body;
        const mutedList = (user.mutedPacks || []).map(String);
        const currentMuted = mutedList.includes(packId.toString());
        const shouldMute = typeof muted === 'boolean' ? muted : !currentMuted;

        if (shouldMute) {
            await User.findByIdAndUpdate(userId, { $addToSet: { mutedPacks: packId } });
        } else {
            await User.findByIdAndUpdate(userId, { $pull: { mutedPacks: packId } });
        }

        res.status(200).json({ status: 'success', isMuted: shouldMute });
    } catch (error) {
        console.error('togglePackLoungeMute error:', error);
        res.status(500).json({ message: 'Sessize alma işlemi başarısız.' });
    }
};

// @desc    Get lounge mute status for current user
// @route   GET /api/packs/:packId/lounge/mute
// @access  Private
export const getPackLoungeMuteStatus = async (req, res) => {
    try {
        const { packId } = req.params;
        const userId = req.user?._id || req.user?.id;
        if (!userId || !isValidObjectId(packId)) {
            return res.status(400).json({ message: 'Geçersiz istek.' });
        }

        const user = await User.findById(userId).select('mutedPacks');
        if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });

        const mutedList = (user.mutedPacks || []).map(String);
        const isMuted = mutedList.includes(packId.toString());

        res.status(200).json({ status: 'success', isMuted });
    } catch (error) {
        console.error('getPackLoungeMuteStatus error:', error);
        res.status(500).json({ message: 'Mute durumu alınamadı.' });
    }
};
