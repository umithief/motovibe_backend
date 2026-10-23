import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { raiseHttpError } from '../../utils/httpError.js';

import Story from "./model.js";
import StoryView from "./StoryView.model.js";
import User from "../users/model.js";
import Conversation from "../messages/Conversation.model.js";
import Message from "../messages/model.js";
import Highlight from "./Highlight.model.js";
import { notifyTextMentions } from "../notifications/mention.service.js";

// @desc    Create a new story
// @route   POST /api/stories
// @access  Private
export const createStory = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { mediaUrl, mediaType, caption, location, bikeModel, privacy } = input.body;

        if (!mediaUrl || typeof mediaUrl !== 'string') {
            return raiseHttpError({ message: 'Geçerli bir medya bağlantısı (URL) zorunludur.' },400);
        }

        const trimmedUrl = mediaUrl.trim();
        if (trimmedUrl.length > 2048) {
            return raiseHttpError({ message: 'Medya bağlantısı en fazla 2048 karakter olabilir.' },400);
        }

        const urlPattern = /^(https?:\/\/|\/|uploads\/)[^\s]*$/i;

        if (!urlPattern.test(trimmedUrl) || trimmedUrl.startsWith('javascript:')) {
            return raiseHttpError({ message: 'Medya bağlantısı geçerli bir URL olmalıdır.' },400);
        }

        const normalizedMediaType = (mediaType || 'IMAGE').toString().toUpperCase();
        if (!['IMAGE', 'VIDEO'].includes(normalizedMediaType)) {
            return raiseHttpError({ message: 'Geçersiz medya türü. Sadece IMAGE veya VIDEO kabul edilir.' },400);
        }

        const normalizedPrivacy = (privacy || 'PUBLIC').toString().toUpperCase();
        const safePrivacy = ['PUBLIC', 'FOLLOWERS'].includes(normalizedPrivacy) ? normalizedPrivacy : 'PUBLIC';

        const story = new Story({
            userId: input.user._id,
            mediaUrl: trimmedUrl,
            mediaType: normalizedMediaType,
            privacy: safePrivacy,
            caption: caption ? caption.toString().trim() : '',
            location: location ? location.toString().trim() : '',
            bikeModel: bikeModel ? bikeModel.toString().trim() : '',
        });

        await story.save();
        await story.populate('userId', 'name avatar username');

        if (story.caption.includes('@')) {
            // Followers-only stories must not reach mentioned non-followers.
            const audience = safePrivacy === 'FOLLOWERS'
                ? (await User.findById(input.user._id).select('followers').lean())?.followers || []
                : undefined;
            notifyTextMentions({
                text: story.caption,
                actorId: input.user._id,
                type: 'MENTIONED_IN_STORY',
                allowedUserIds: audience,
                refs: { relatedId: story._id.toString() },
            });
        }

        respond(story,201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get active stories grouped by user
// @route   GET /api/stories
// @access  Public / Optional Auth
export const getStories = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const currentUserId = input.user?._id || null;

        const matchQuery = { expiresAt: { $gt: new Date() } };

        const stories = await Story.aggregate([
            { $match: matchQuery },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: '$userId',
                    stories: { $push: '$$ROOT' },
                    lastUpdated: { $max: '$createdAt' }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    _id: 1,
                    user: {
                        _id: 1,
                        name: 1,
                        username: 1,
                        avatar: 1
                    },
                    stories: 1,
                    lastUpdated: 1
                }
            },
            { $sort: { lastUpdated: -1 } }
        ]);

        let viewedSet = new Set();
        let followingSet = new Set();
        let blockedUsersSet = new Set();

        if (currentUserId) {
            const [viewedStoryIds, currentUser, usersBlockingMe] = await Promise.all([
                StoryView.find({ viewerId: currentUserId }).distinct('storyId'),
                User.findById(currentUserId).select('following blockedUsers').lean(),
                User.find({ blockedUsers: currentUserId }).select('_id').lean()
            ]);
            viewedSet = new Set(viewedStoryIds.map(id => id.toString()));
            const followingIds = currentUser?.following || [];
            followingSet = new Set(followingIds.map(id => id.toString()));
            const blockedIds = currentUser?.blockedUsers || [];
            blockedIds.forEach(id => blockedUsersSet.add(id.toString()));
            (usersBlockingMe || []).forEach(u => blockedUsersSet.add(u._id.toString()));
        }

        const result = stories
            .filter(group => {
                const authorId = group.user?._id?.toString();
                if (!authorId) return false;
                if (currentUserId && blockedUsersSet.has(authorId)) {
                    return false;
                }
                return true;
            })
            .map(group => {
                const visibleStories = group.stories.filter(story => {
                    const isOwner = currentUserId && story.userId.toString() === currentUserId.toString();
                    if (isOwner) return true;
                    const p = story.privacy || 'PUBLIC';
                    if (p === 'PUBLIC') return true;
                    if (p === 'FOLLOWERS') {
                        return Boolean(currentUserId && followingSet.has(story.userId.toString()));
                    }
                    return false;
                });

                if (visibleStories.length === 0) return null;

                const storiesWithSeen = visibleStories.map(story => {
                    const storyLikes = Array.isArray(story.likes) ? story.likes : [];
                    const isLiked = currentUserId
                        ? storyLikes.some(id => id.toString() === currentUserId.toString())
                        : false;

                    return {
                        ...story,
                        privacy: story.privacy || 'PUBLIC',
                        seen: viewedSet.has(story._id.toString()),
                        isLiked,
                        likesCount: storyLikes.length,
                        viewsCount: story.views || 0,
                        caption: story.caption || '',
                        location: story.location || '',
                        bikeModel: story.bikeModel || ''
                    };
                });

                const allSeen = storiesWithSeen.every(s => s.seen);

                return {
                    user: group.user,
                    userId: group.user._id,
                    username: group.user.name || group.user.username || 'Sürücü',
                    userAvatar: group.user.avatar || '',
                    stories: storiesWithSeen,
                    allSeen,
                    lastUpdated: group.lastUpdated
                };
            })
            .filter(Boolean);

        // Smart ordering:
        // 1. Own story first
        // 2. Unseen stories before seen
        // 3. Followed users prioritized
        if (currentUserId) {
            result.sort((a, b) => {
                const aId = a.userId.toString();
                const bId = b.userId.toString();
                const curId = currentUserId.toString();

                if (aId === curId) return -1;
                if (bId === curId) return 1;

                if (!a.allSeen && b.allSeen) return -1;
                if (a.allSeen && !b.allSeen) return 1;

                const aFollowed = followingSet.has(aId);
                const bFollowed = followingSet.has(bId);
                if (aFollowed && !bFollowed) return -1;
                if (!aFollowed && bFollowed) return 1;

                return new Date(b.lastUpdated) - new Date(a.lastUpdated);
            });
        }

        respond(result,200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Mark a story as viewed
// @route   POST /api/stories/:id/view
// @access  Private
export const viewStory = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const storyId = input.params.id;
        const userId = input.user._id;

        const story = await Story.findById(storyId);
        if (!story) {
            return raiseHttpError({ message: 'Story not found' },404);
        }

        const existingView = await StoryView.findOne({ storyId, viewerId: userId });

        if (!existingView) {
            await StoryView.create({
                storyId,
                viewerId: userId
            });

            await Story.findByIdAndUpdate(storyId, { $inc: { views: 1 } });
        }

        respond({ success: true },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Like a story
// @route   POST /api/stories/:id/like
// @access  Private
export const likeStory = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const storyId = input.params.id;
        const userId = input.user._id;

        const story = await Story.findById(storyId);
        if (!story) {
            return raiseHttpError({ message: 'Hikaye bulunamadı.' },404);
        }

        if (!Array.isArray(story.likes)) {
            story.likes = [];
        }

        const alreadyLiked = story.likes.some(id => id.toString() === userId.toString());
        if (!alreadyLiked) {
            story.likes.push(userId);
            await story.save();
        }

        respond({ success: true, likesCount: story.likes.length },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Unlike a story
// @route   DELETE /api/stories/:id/like
// @access  Private
export const unlikeStory = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const storyId = input.params.id;
        const userId = input.user._id;

        const story = await Story.findById(storyId);
        if (!story) {
            return raiseHttpError({ message: 'Hikaye bulunamadı.' },404);
        }

        if (Array.isArray(story.likes)) {
            story.likes = story.likes.filter(id => id.toString() !== userId.toString());
            await story.save();
        }

        respond({ success: true, likesCount: story.likes?.length || 0 },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    React to a story with an emoji
// @route   POST /api/stories/:id/react
// @access  Private
export const reactToStory = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const storyId = input.params.id;
        const userId = input.user._id;
        const { emoji } = input.body;

        if (!emoji || typeof emoji !== 'string' || emoji.trim().length === 0) {
            return raiseHttpError({ message: 'Emoji zorunludur.' },400);
        }

        const story = await Story.findById(storyId);
        if (!story) {
            return raiseHttpError({ message: 'Hikaye bulunamadı.' },404);
        }

        if (!Array.isArray(story.reactions)) {
            story.reactions = [];
        }

        const trimmedEmoji = emoji.trim();
        const existingReactionIndex = story.reactions.findIndex(
            r => r.userId.toString() === userId.toString()
        );

        if (existingReactionIndex !== -1) {
            story.reactions[existingReactionIndex].emoji = trimmedEmoji;
            story.reactions[existingReactionIndex].createdAt = new Date();
        } else {
            story.reactions.push({
                userId,
                emoji: trimmedEmoji,
                createdAt: new Date()
            });
        }
        await story.save();

        respond({ success: true },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get viewers of a story (Story owner only)
// @route   GET /api/stories/:id/viewers
// @access  Private
export const getStoryViewers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const storyId = input.params.id;
        const userId = input.user._id;

        const story = await Story.findById(storyId)
            .select('userId reactions likes')
            .populate('reactions.userId', 'name username avatar')
            .populate('likes', 'name username avatar')
            .lean();

        if (!story) {
            return raiseHttpError({ message: 'Hikaye bulunamadı.' },404);
        }

        const isOwner = story.userId.toString() === userId.toString();
        const isAdmin = Boolean(input.user.isAdmin);

        if (!isOwner && !isAdmin) {
            return raiseHttpError({ message: 'Görüntüleyenleri yalnızca hikaye sahibi görebilir.' },403);
        }

        const views = await StoryView.find({ storyId })
            .populate('viewerId', 'name username avatar')
            .sort({ viewedAt: -1 })
            .lean();

        const viewers = views
            .filter(v => v.viewerId)
            .map(v => ({
                id: v.viewerId._id,
                name: v.viewerId.name || v.viewerId.username || 'Sürücü',
                username: v.viewerId.username,
                avatar: v.viewerId.avatar || '',
                viewedAt: v.viewedAt
            }));

        const reactions = (story.reactions || [])
            .filter(r => r.userId)
            .map(r => ({
                id: r.userId._id,
                name: r.userId.name || r.userId.username || 'Sürücü',
                username: r.userId.username,
                avatar: r.userId.avatar || '',
                emoji: r.emoji,
                createdAt: r.createdAt
            }))
            .reverse();

        const likes = (story.likes || [])
            .filter(Boolean)
            .map(u => ({
                id: u._id,
                name: u.name || u.username || 'Sürücü',
                username: u.username,
                avatar: u.avatar || ''
            }));

        respond({
            viewers,
            reactions,
            likes,
            count: viewers.length,
            reactionsCount: reactions.length,
            likesCount: likes.length
        },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Reply to a story via direct message
// @route   POST /api/stories/:id/reply
// @access  Private
export const replyToStory = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const storyId = input.params.id;
        const senderId = input.user._id;
        const rawContent = input.body?.content;
        const content = (rawContent || '').toString().trim();

        if (!content) {
            return raiseHttpError({ message: 'Yanıt metni bos olamaz.' },400);
        }

        if (content.length > 500) {
            return raiseHttpError({ message: 'Yanıt en fazla 500 karakter olabilir.' },400);
        }

        const story = await Story.findById(storyId).select('_id userId expiresAt').lean();
        if (!story) {
            return raiseHttpError({ message: 'Story not found' },404);
        }

        if (story.expiresAt && new Date(story.expiresAt) <= new Date()) {
            return raiseHttpError({ message: 'Bu hikayenin suresi dolmus.' },410);
        }

        const recipientId = story.userId?.toString();
        if (!recipientId) {
            return raiseHttpError({ message: 'Hikaye sahibi bulunamadı.' },404);
        }

        if (recipientId === senderId.toString()) {
            return raiseHttpError({ message: 'Kendi hikayene yanit gonderemezsin.' },400);
        }

        let conversation = await Conversation.findOne({
            participants: { $all: [senderId, recipientId], $size: 2 },
            isGroup: false
        });

        if (!conversation) {
            conversation = await Conversation.create({
                participants: [senderId, recipientId],
                isGroup: false,
                unreadCount: {
                    [senderId]: 0,
                    [recipientId]: 0
                }
            });
        }

        const message = await Message.create({
            conversationId: conversation._id,
            sender: senderId,
            type: 'TEXT',
            content: `Hikaye yanıtı: ${content}`,
            status: 'SENT',
            readBy: [senderId]
        });

        conversation.lastMessage = message._id;
        conversation.updatedAt = Date.now();
        const unreadForRecipient = conversation.unreadCount.get(recipientId) || 0;
        conversation.unreadCount.set(recipientId, unreadForRecipient + 1);
        await conversation.save();

        try {
            const { getIO } = await import("../../socket.js");
            const io = getIO();
            io.to(recipientId).emit('receive_message', {
                id: message._id.toString(),
                conversationId: conversation._id.toString(),
                senderId: senderId.toString(),
                type: 'TEXT',
                content: message.content,
                status: 'SENT',
                createdAt: message.createdAt.toISOString()
            });
        } catch (socketErr) {
            console.warn('[Story Reply] Socket emit skipped:', socketErr.message);
        }

        return respond({
            success: true,
            message: 'Hikaye yanıtı gönderildi.',
            data: {
                conversationId: conversation._id,
                messageId: message._id
            }
        },201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Delete a story
// @route   DELETE /api/stories/:id
// @access  Private
export const deleteStory = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const story = await Story.findById(input.params.id);
        if (!story) {
            return raiseHttpError({ status: 'error', message: 'Hikaye bulunamadı.' },404);
        }

        const isOwner = story.userId.toString() === input.user._id.toString();
        const isAdmin = Boolean(input.user.isAdmin);

        if (!isOwner && !isAdmin) {
            return raiseHttpError({ status: 'error', message: 'Bu hikayeyi silme yetkiniz yok.' },403);
        }

        await Story.findByIdAndDelete(input.params.id);
        await StoryView.deleteMany({ storyId: input.params.id });

        respond({ status: 'success', message: 'Hikaye başarıyla silindi.' },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Create a new highlight
// @route   POST /api/stories/highlights
// @access  Private
export const createHighlight = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const userId = input.user._id;
        const { title, coverUrl, items, isPro } = input.body;

        if (!title || typeof title !== 'string' || !title.trim()) {
            return raiseHttpError({ message: 'Öne çıkarma başlığı zorunludur.' },400);
        }

        const formattedItems = Array.isArray(items) ? items.map(it => ({
            mediaUrl: it.mediaUrl,
            mediaType: ['IMAGE', 'VIDEO'].includes((it.mediaType || '').toUpperCase()) ? it.mediaType.toUpperCase() : 'IMAGE',
            caption: it.caption ? it.caption.toString().trim() : '',
            location: it.location ? it.location.toString().trim() : '',
            bikeModel: it.bikeModel ? it.bikeModel.toString().trim() : '',
            storyId: it.storyId || null,
            createdAt: it.createdAt || new Date()
        })) : [];

        const highlight = new Highlight({
            userId,
            title: title.trim(),
            coverUrl: coverUrl || (formattedItems[0]?.mediaUrl || ''),
            items: formattedItems,
            isPro: Boolean(isPro)
        });

        await highlight.save();
        respond(highlight,201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get user's highlights
// @route   GET /api/stories/highlights/user/:userId
// @access  Public / Optional Auth
export const getUserHighlights = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { userId } = input.params;
        const highlights = await Highlight.find({ userId })
            .sort({ createdAt: -1 })
            .lean();

        respond(highlights,200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Delete a highlight
// @route   DELETE /api/stories/highlights/:id
// @access  Private
export const deleteHighlight = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const highlight = await Highlight.findById(input.params.id);
        if (!highlight) {
            return raiseHttpError({ message: 'Öne çıkan bulunamadı.' },404);
        }

        const isOwner = highlight.userId.toString() === input.user._id.toString();
        const isAdmin = Boolean(input.user.isAdmin);

        if (!isOwner && !isAdmin) {
            return raiseHttpError({ message: 'Bu öne çıkarılanı silme yetkiniz yok.' },403);
        }

        await Highlight.findByIdAndDelete(input.params.id);
        respond({ success: true, message: 'Öne çıkan başarıyla silindi.' },200);
    } catch (error) { throw error; }

    return response;
};
