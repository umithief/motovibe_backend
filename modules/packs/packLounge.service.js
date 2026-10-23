import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { raiseHttpError } from '../../utils/httpError.js';

import mongoose from 'mongoose';

import Pack from "./model.js";
import PackLoungeMessage from "./PackLoungeMessage.model.js";
import User from "../users/model.js";
import { isApprovedMember } from "../../utils/packMembership.js";

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
export const getPackLoungeMessages = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        if (!isValidObjectId(packId)) {
            return raiseHttpError({ message: 'Geçersiz klan kimliği.' },400);
        }

        const userId = input.user?._id;
        if (!userId) {
            return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);
        }

        if (!(await canAccessPack(packId, userId))) {
            return raiseHttpError({ message: 'Lounge yalnızca onaylı üyelere açıktır.' },403);
        }

        const parsedLimit = Number.parseInt(input.query.limit, 10);
        const limit = Number.isFinite(parsedLimit)
            ? Math.min(80, Math.max(1, parsedLimit))
            : 50;
        const before = input.query.before?.toString().trim();
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

        respond({
            messages: messages.reverse().map(toMessagePayload),
            hasMore: messages.length >= limit,
        },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Send a pack lounge message (HTTP fallback)
// @route   POST /api/packs/:packId/lounge/messages
// @access  Private (approved pack members)
export const postPackLoungeMessage = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        if (!isValidObjectId(packId)) {
            return raiseHttpError({ message: 'Geçersiz klan kimliği.' },400);
        }

        const userId = input.user?._id;
        if (!userId) {
            return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);
        }

        const content = input.body?.content?.toString?.().trim?.() || '';
        const msgType = (input.body?.type || 'TEXT').toString().toUpperCase();

        if (!content) {
            return raiseHttpError({ message: 'Mesaj içeriği boş olamaz.' },400);
        }
        if (content.length > 4000) {
            return raiseHttpError({ message: 'Mesaj en fazla 4000 karakter olabilir.' },400);
        }

        if (!(await canAccessPack(packId, userId))) {
            return raiseHttpError({ message: 'Lounge yalnızca onaylı üyelere açıktır.' },403);
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
            return raiseHttpError({ message: 'Mesaj kaydedildi ancak okunamadı.' },500);
        }
        respond({ message: toMessagePayload(populated) },201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Delete a pack lounge message
// @route   DELETE /api/packs/:packId/lounge/messages/:messageId
// @access  Private (approved pack members: author, admin, owner)
export const deletePackLoungeMessage = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, messageId } = input.params;
        if (!isValidObjectId(packId) || !isValidObjectId(messageId)) {
            return raiseHttpError({ message: 'Geçersiz kimlik.' },400);
        }

        const userId = input.user?._id?.toString?.() || input.user?.id?.toString?.();
        if (!userId) {
            return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);
        }

        const pack = await Pack.findById(packId).select('owner admins members').lean();
        if (!pack) {
            return raiseHttpError({ message: 'Klan bulunamadı.' },404);
        }

        const msg = await PackLoungeMessage.findById(messageId);
        if (!msg) {
            return raiseHttpError({ message: 'Mesaj bulunamadı.' },404);
        }

        const isOwner = pack.owner?.toString() === userId;
        const isAdmin = Array.isArray(pack.admins) && pack.admins.some(a => a.toString() === userId);
        const isSender = msg.sender?.toString() === userId;

        if (!isOwner && !isAdmin && !isSender) {
            return raiseHttpError({ message: 'Bu mesajı silme yetkiniz yok.' },403);
        }

        await PackLoungeMessage.findByIdAndDelete(messageId);

        if (global.io) {
            global.io.to(`pack_lounge_${packId}`).emit('pack_lounge_message_deleted', {
                packId,
                messageId
            });
        }

        respond({ status: 'success', message: 'Mesaj silindi.', messageId },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Toggle lounge mute for current user
// @route   POST /api/packs/:packId/lounge/mute
// @access  Private
export const togglePackLoungeMute = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        const userId = input.user?._id || input.user?.id;
        if (!userId || !isValidObjectId(packId)) {
            return raiseHttpError({ message: 'Geçersiz istek.' },400);
        }

        const user = await User.findById(userId);
        if (!user) return raiseHttpError({ message: 'Kullanıcı bulunamadı.' },404);

        const { muted } = input.body;
        const mutedList = (user.mutedPacks || []).map(String);
        const currentMuted = mutedList.includes(packId.toString());
        const shouldMute = typeof muted === 'boolean' ? muted : !currentMuted;

        if (shouldMute) {
            await User.findByIdAndUpdate(userId, { $addToSet: { mutedPacks: packId } });
        } else {
            await User.findByIdAndUpdate(userId, { $pull: { mutedPacks: packId } });
        }

        respond({ status: 'success', isMuted: shouldMute },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get lounge mute status for current user
// @route   GET /api/packs/:packId/lounge/mute
// @access  Private
export const getPackLoungeMuteStatus = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        const userId = input.user?._id || input.user?.id;
        if (!userId || !isValidObjectId(packId)) {
            return raiseHttpError({ message: 'Geçersiz istek.' },400);
        }

        const user = await User.findById(userId).select('mutedPacks');
        if (!user) return raiseHttpError({ message: 'Kullanıcı bulunamadı.' },404);

        const mutedList = (user.mutedPacks || []).map(String);
        const isMuted = mutedList.includes(packId.toString());

        respond({ status: 'success', isMuted },200);
    } catch (error) { throw error; }

    return response;
};
