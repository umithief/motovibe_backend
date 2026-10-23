import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { raiseHttpError } from '../../utils/httpError.js';

import mongoose from 'mongoose';
import PackPost from "./PackPost.model.js";
import Pack from "./model.js";
import {
    approvedMemberIds,
    canManagePackAction,
    findPackMember,
    isApprovedMember,
} from "../../utils/packMembership.js";
import { notifyTextMentions } from "../notifications/mention.service.js";

const isValidObjectId = (v = '') => mongoose.Types.ObjectId.isValid(v);

const canModeratePack = (pack, userId) => {
    return canManagePackAction(pack, userId, 'pin');
};

const requirePackFeedReadAccess = async (packId, userId) => {
    const pack = await Pack.findById(packId)
        .select('isPrivate isDeleted memberRoles members owner admins joinRequests')
        .lean();
    if (!pack || pack.isDeleted) {
        raiseHttpError({ message: 'Klan bulunamadı.' },404);
        return null;
    }
    if (pack.isPrivate && !isApprovedMember(pack, userId)) {
        raiseHttpError({ message: 'Özel klan akışı yalnızca onaylı üyelere açıktır.' },403);
        return null;
    }
    return pack;
};

// @desc    Create a post in a pack feed
// @route   POST /api/packs/:packId/posts
// @access  Private (members only)
export const createPackPost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        if (!isValidObjectId(packId)) {
            return raiseHttpError({ message: 'Geçersiz Pack ID.' },400);
        }

        const userId = input.user?._id;
        if (!userId) return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);

        const pack = await Pack.findById(packId)
            .select('isDeleted memberRoles members owner admins joinRequests')
            .lean();
        if (!pack) return raiseHttpError({ message: 'Pack bulunamadı.' },404);

        if (!isApprovedMember(pack, userId)) {
            return raiseHttpError({ message: 'Sadece üyeler gönderi paylaşabilir.' },403);
        }

        const content = (input.body.content || '').toString().trim();
        const image = (input.body.image || '').toString().trim();
        const postType = input.body.postType || (image ? 'PHOTO' : 'TEXT');

        if (!content && !image && postType === 'TEXT') {
            return raiseHttpError({ message: 'İçerik veya görsel gerekli.' },400);
        }

        const isAnnouncement = input.body.isAnnouncement === true;
        const isAdmin = canModeratePack(pack, userId) || (pack.admins || []).some(
            (admin) => admin.toString() === userId.toString(),
        );

        let attachedRoute = input.body.attachedRoute || undefined;
        if (attachedRoute && typeof attachedRoute === 'object') {
            if (attachedRoute.routeId && !mongoose.Types.ObjectId.isValid(attachedRoute.routeId)) {
                delete attachedRoute.routeId;
            }
            if (Object.keys(attachedRoute).length === 0 || (!attachedRoute.routeId && !attachedRoute.name)) {
                attachedRoute = undefined;
            }
        }

        const post = await PackPost.create({
            pack: packId,
            author: userId,
            content,
            image,
            postType,
            attachedRoute,
            attachedBike: input.body.attachedBike || undefined,
            attachedMap: input.body.attachedMap || undefined,
            isAnnouncement: isAnnouncement && isAdmin,
            isPinned: false,
        });

        const populated = await PackPost.findById(post._id)
            .populate('author', 'name username avatar')
            .lean();

        notifyTextMentions({
            text: content,
            actorId: userId,
            type: 'MENTIONED_IN_PACK',
            allowedUserIds: approvedMemberIds(pack),
            refs: { pack: packId, relatedId: String(post._id) },
        });

        respond(populated,201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get pack feed posts
// @route   GET /api/packs/:packId/posts
// @access  Private
export const getPackPosts = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        if (!isValidObjectId(packId)) {
            return raiseHttpError({ message: 'Geçersiz Pack ID.' },400);
        }

        const page = Math.max(1, parseInt(input.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(input.query.limit) || 20));
        const skip = (page - 1) * limit;

        const userId = input.user?._id?.toString() || '';
        const pack = await requirePackFeedReadAccess(packId,userId);
        if (!pack) return;

        const posts = await PackPost.find({ pack: packId })
            .sort({ isPinned: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('author', 'name username avatar')
            .populate('comments.author', 'name username avatar')
            .lean();

        const result = posts.map(post => ({
            ...post,
            _id: post._id.toString(),
            isLiked: (post.likes || []).some(id => id.toString() === userId),
            likeCount: post.likeCount || 0,
            commentCount: post.commentCount || 0,
            comments: (post.comments || []).slice(0, 3).map(c => ({
                _id: c._id?.toString(),
                text: c.text,
                createdAt: c.createdAt,
                author: c.author || {},
            })),
        }));

        respond(result,200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Toggle like on a pack post
// @route   POST /api/packs/:packId/posts/:postId/like
// @access  Private
export const togglePackPostLike = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, postId } = input.params;
        if (!isValidObjectId(postId)) {
            return raiseHttpError({ message: 'Geçersiz Post ID.' },400);
        }

        const userId = input.user?._id;
        if (!userId) return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);

        const pack = await requirePackFeedReadAccess(packId,userId);
        if (!pack || !isApprovedMember(pack, userId)) {
            if (pack) raiseHttpError({ message: 'Beğeni yalnızca klan üyelerine açıktır.' },403);
            return;
        }

        const post = await PackPost.findOne({ _id: postId, pack: packId })
            .select('likes likeCount')
            .lean();
        if (!post) return raiseHttpError({ message: 'Gönderi bulunamadı.' },404);

        const likeIds = (post.likes || []).map(id => id.toString());
        const isLiked = likeIds.includes(userId.toString());

        if (isLiked) {
            await PackPost.updateOne(
                { _id: postId },
                { $pull: { likes: userId }, $inc: { likeCount: -1 } }
            );
        } else {
            await PackPost.updateOne(
                { _id: postId },
                { $addToSet: { likes: userId }, $inc: { likeCount: 1 } }
            );
        }

        respond({ isLiked: !isLiked, likeCount: (post.likeCount || 0) + (isLiked ? -1 : 1) },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Add comment to a pack post
// @route   POST /api/packs/:packId/posts/:postId/comment
// @access  Private
export const addPackPostComment = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, postId } = input.params;
        if (!isValidObjectId(postId)) {
            return raiseHttpError({ message: 'Geçersiz Post ID.' },400);
        }

        const userId = input.user?._id;
        if (!userId) return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);

        const pack = await requirePackFeedReadAccess(packId,userId);
        if (!pack || !isApprovedMember(pack, userId)) {
            if (pack) raiseHttpError({ message: 'Yorum yalnızca klan üyelerine açıktır.' },403);
            return;
        }

        const text = (input.body.text || '').toString().trim();
        if (!text) return raiseHttpError({ message: 'Yorum boş olamaz.' },400);

        const result = await PackPost.findOneAndUpdate(
            { _id: postId, pack: packId },
            {
                $push: {
                    comments: {
                        author: userId,
                        text,
                        createdAt: new Date(),
                    },
                },
                $inc: { commentCount: 1 },
            },
            { new: true }
        )
            .populate('comments.author', 'name username avatar')
            .lean();

        if (!result) return raiseHttpError({ message: 'Gönderi bulunamadı.' },404);

        const lastComment = result.comments[result.comments.length - 1];
        notifyTextMentions({
            text,
            actorId: userId,
            type: 'MENTIONED_IN_PACK',
            allowedUserIds: approvedMemberIds(pack),
            refs: { pack: packId, relatedId: String(postId), commentId: lastComment._id?.toString() },
        });
        respond({
            _id: lastComment._id?.toString(),
            text: lastComment.text,
            createdAt: lastComment.createdAt,
            author: lastComment.author || {},
            commentCount: result.commentCount,
        },201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Delete a pack post
// @route   DELETE /api/packs/:packId/posts/:postId
// @access  Private (author or admin)
export const deletePackPost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, postId } = input.params;
        if (!isValidObjectId(postId)) {
            return raiseHttpError({ message: 'Geçersiz Post ID.' },400);
        }

        const userId = input.user?._id;
        if (!userId) return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);

        const pack = await requirePackFeedReadAccess(packId,userId);
        if (!pack || !isApprovedMember(pack, userId)) {
            if (pack) raiseHttpError({ message: 'Gönderi işlemi yalnızca klan üyelerine açıktır.' },403);
            return;
        }

        const post = await PackPost.findOne({ _id: postId, pack: packId })
            .select('author pack')
            .lean();
        if (!post) return raiseHttpError({ message: 'Gönderi bulunamadı.' },404);

        // Check ownership or admin privileges
        const isAuthor = post.author.toString() === userId.toString();
        if (!isAuthor) {
            if (!canModeratePack(pack, userId) && !(pack.admins || []).some(
                (admin) => admin.toString() === userId.toString(),
            )) {
                return raiseHttpError({ message: 'Bu gönderiyi silme yetkiniz yok.' },403);
            }
        }

        await PackPost.findByIdAndDelete(postId);
        respond({ success: true, message: 'Gönderi silindi.' },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Toggle pin on a pack post (admin only)
// @route   POST /api/packs/:packId/posts/:postId/pin
// @access  Private (admin only)
export const togglePinPackPost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, postId } = input.params;
        if (!isValidObjectId(postId) || !isValidObjectId(packId)) {
            return raiseHttpError({ message: 'Geçersiz ID.' },400);
        }

        const userId = input.user?._id;
        if (!userId) return raiseHttpError({ message: 'Kimlik doğrulama gerekli.' },401);

        const pack = await Pack.findById(packId)
            .select('isDeleted owner admins memberRoles members joinRequests isPrivate')
            .lean();
        if (!pack) return raiseHttpError({ message: 'Pack bulunamadı.' },404);

        if (!isApprovedMember(pack, userId) || (!canModeratePack(pack, userId) && !(pack.admins || []).some(
            (admin) => admin.toString() === userId.toString(),
        ))) {
            return raiseHttpError({ message: 'Sabitleme yetkisi yok.' },403);
        }

        const post = await PackPost.findOne({ _id: postId, pack: packId }).select('isPinned');
        if (!post) return raiseHttpError({ message: 'Gönderi bulunamadı.' },404);

        post.isPinned = !post.isPinned;
        await post.save();

        respond({ isPinned: post.isPinned },200);
    } catch (error) { throw error; }

    return response;
};
