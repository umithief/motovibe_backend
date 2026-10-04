import Story from '../models/Story.js';
import StoryView from '../models/StoryView.js';
import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Highlight from '../models/Highlight.js';

// @desc    Create a new story
// @route   POST /api/stories
// @access  Private
export const createStory = async (req, res) => {
    try {
        const { mediaUrl, mediaType, caption, location, bikeModel, privacy } = req.body;

        if (!mediaUrl || typeof mediaUrl !== 'string') {
            return res.status(400).json({ message: 'Geçerli bir medya bağlantısı (URL) zorunludur.' });
        }

        const trimmedUrl = mediaUrl.trim();
        if (trimmedUrl.length > 2048) {
            return res.status(400).json({ message: 'Medya bağlantısı en fazla 2048 karakter olabilir.' });
        }

        const isDevelopment = process.env.NODE_ENV === 'development';
        const urlPattern = isDevelopment 
            ? /^https?:\/\/[^\s/$.?#].[^\s]*$/i 
            : /^https:\/\/[^\s/$.?#].[^\s]*$/i;

        if (!urlPattern.test(trimmedUrl) || trimmedUrl.startsWith('javascript:')) {
            return res.status(400).json({ message: 'Medya bağlantısı güvenli bir web adresi (HTTPS) olmalıdır.' });
        }

        const normalizedMediaType = (mediaType || 'IMAGE').toString().toUpperCase();
        if (!['IMAGE', 'VIDEO'].includes(normalizedMediaType)) {
            return res.status(400).json({ message: 'Geçersiz medya türü. Sadece IMAGE veya VIDEO kabul edilir.' });
        }

        const normalizedPrivacy = (privacy || 'PUBLIC').toString().toUpperCase();
        const safePrivacy = ['PUBLIC', 'FOLLOWERS'].includes(normalizedPrivacy) ? normalizedPrivacy : 'PUBLIC';

        const story = new Story({
            userId: req.user._id,
            mediaUrl: trimmedUrl,
            mediaType: normalizedMediaType,
            privacy: safePrivacy,
            caption: caption ? caption.toString().trim() : '',
            location: location ? location.toString().trim() : '',
            bikeModel: bikeModel ? bikeModel.toString().trim() : '',
        });

        await story.save();
        await story.populate('userId', 'name avatar username');

        res.status(201).json(story);
    } catch (error) {
        console.error('[Create Story Error]:', error);
        res.status(500).json({ message: 'Hikaye oluşturulurken sunucu hatası oluştu.' });
    }
};

// @desc    Get active stories grouped by user
// @route   GET /api/stories
// @access  Public / Optional Auth
export const getStories = async (req, res) => {
    try {
        const currentUserId = req.user?._id || null;

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

        res.json(result);
    } catch (error) {
        console.error('[Get Stories Error]:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Mark a story as viewed
// @route   POST /api/stories/:id/view
// @access  Private
export const viewStory = async (req, res) => {
    try {
        const storyId = req.params.id;
        const userId = req.user._id;

        const story = await Story.findById(storyId);
        if (!story) {
            return res.status(404).json({ message: 'Story not found' });
        }

        const existingView = await StoryView.findOne({ storyId, viewerId: userId });

        if (!existingView) {
            await StoryView.create({
                storyId,
                viewerId: userId
            });

            await Story.findByIdAndUpdate(storyId, { $inc: { views: 1 } });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[View Story Error]:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Like a story
// @route   POST /api/stories/:id/like
// @access  Private
export const likeStory = async (req, res) => {
    try {
        const storyId = req.params.id;
        const userId = req.user._id;

        const story = await Story.findById(storyId);
        if (!story) {
            return res.status(404).json({ message: 'Hikaye bulunamadı.' });
        }

        if (!Array.isArray(story.likes)) {
            story.likes = [];
        }

        const alreadyLiked = story.likes.some(id => id.toString() === userId.toString());
        if (!alreadyLiked) {
            story.likes.push(userId);
            await story.save();
        }

        res.status(200).json({ success: true, likesCount: story.likes.length });
    } catch (error) {
        console.error('[Like Story Error]:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Unlike a story
// @route   DELETE /api/stories/:id/like
// @access  Private
export const unlikeStory = async (req, res) => {
    try {
        const storyId = req.params.id;
        const userId = req.user._id;

        const story = await Story.findById(storyId);
        if (!story) {
            return res.status(404).json({ message: 'Hikaye bulunamadı.' });
        }

        if (Array.isArray(story.likes)) {
            story.likes = story.likes.filter(id => id.toString() !== userId.toString());
            await story.save();
        }

        res.status(200).json({ success: true, likesCount: story.likes?.length || 0 });
    } catch (error) {
        console.error('[Unlike Story Error]:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    React to a story with an emoji
// @route   POST /api/stories/:id/react
// @access  Private
export const reactToStory = async (req, res) => {
    try {
        const storyId = req.params.id;
        const userId = req.user._id;
        const { emoji } = req.body;

        if (!emoji || typeof emoji !== 'string' || emoji.trim().length === 0) {
            return res.status(400).json({ message: 'Emoji zorunludur.' });
        }

        const story = await Story.findById(storyId);
        if (!story) {
            return res.status(404).json({ message: 'Hikaye bulunamadı.' });
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

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[React Story Error]:', error);
        res.status(500).json({ message: 'Reaksiyon kaydedilirken sunucu hatası oluştu.' });
    }
};

// @desc    Get viewers of a story (Story owner only)
// @route   GET /api/stories/:id/viewers
// @access  Private
export const getStoryViewers = async (req, res) => {
    try {
        const storyId = req.params.id;
        const userId = req.user._id;

        const story = await Story.findById(storyId)
            .select('userId reactions likes')
            .populate('reactions.userId', 'name username avatar')
            .populate('likes', 'name username avatar')
            .lean();

        if (!story) {
            return res.status(404).json({ message: 'Hikaye bulunamadı.' });
        }

        const isOwner = story.userId.toString() === userId.toString();
        const isAdmin = Boolean(req.user.isAdmin);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Görüntüleyenleri yalnızca hikaye sahibi görebilir.' });
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

        res.status(200).json({
            viewers,
            reactions,
            likes,
            count: viewers.length,
            reactionsCount: reactions.length,
            likesCount: likes.length
        });
    } catch (error) {
        console.error('[Get Story Viewers Error]:', error);
        res.status(500).json({ message: 'Görüntüleyenler listesi alınırken sunucu hatası oluştu.' });
    }
};

// @desc    Reply to a story via direct message
// @route   POST /api/stories/:id/reply
// @access  Private
export const replyToStory = async (req, res) => {
    try {
        const storyId = req.params.id;
        const senderId = req.user._id;
        const rawContent = req.body?.content;
        const content = (rawContent || '').toString().trim();

        if (!content) {
            return res.status(400).json({ message: 'Yanıt metni bos olamaz.' });
        }

        if (content.length > 500) {
            return res.status(400).json({ message: 'Yanıt en fazla 500 karakter olabilir.' });
        }

        const story = await Story.findById(storyId).select('_id userId expiresAt').lean();
        if (!story) {
            return res.status(404).json({ message: 'Story not found' });
        }

        if (story.expiresAt && new Date(story.expiresAt) <= new Date()) {
            return res.status(410).json({ message: 'Bu hikayenin suresi dolmus.' });
        }

        const recipientId = story.userId?.toString();
        if (!recipientId) {
            return res.status(404).json({ message: 'Hikaye sahibi bulunamadı.' });
        }

        if (recipientId === senderId.toString()) {
            return res.status(400).json({ message: 'Kendi hikayene yanit gonderemezsin.' });
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
            const { getIO } = await import('../socket.js');
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

        return res.status(201).json({
            success: true,
            message: 'Hikaye yanıtı gönderildi.',
            data: {
                conversationId: conversation._id,
                messageId: message._id
            }
        });
    } catch (error) {
        console.error('[Story Reply] Error:', error);
        return res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete a story
// @route   DELETE /api/stories/:id
// @access  Private
export const deleteStory = async (req, res) => {
    try {
        const story = await Story.findById(req.params.id);
        if (!story) {
            return res.status(404).json({ status: 'error', message: 'Hikaye bulunamadı.' });
        }

        const isOwner = story.userId.toString() === req.user._id.toString();
        const isAdmin = Boolean(req.user.isAdmin);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ status: 'error', message: 'Bu hikayeyi silme yetkiniz yok.' });
        }

        await Story.findByIdAndDelete(req.params.id);
        await StoryView.deleteMany({ storyId: req.params.id });

        res.status(200).json({ status: 'success', message: 'Hikaye başarıyla silindi.' });
    } catch (error) {
        console.error('[Delete Story Error]:', error);
        res.status(500).json({ status: 'error', message: 'Hikaye silinirken sunucu hatası oluştu.' });
    }
};

// @desc    Create a new highlight
// @route   POST /api/stories/highlights
// @access  Private
export const createHighlight = async (req, res) => {
    try {
        const userId = req.user._id;
        const { title, coverUrl, items, isPro } = req.body;

        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ message: 'Öne çıkarma başlığı zorunludur.' });
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
        res.status(201).json(highlight);
    } catch (error) {
        console.error('[Create Highlight Error]:', error);
        res.status(500).json({ message: 'Öne çıkan oluşturulurken sunucu hatası oluştu.' });
    }
};

// @desc    Get user's highlights
// @route   GET /api/stories/highlights/user/:userId
// @access  Public / Optional Auth
export const getUserHighlights = async (req, res) => {
    try {
        const { userId } = req.params;
        const highlights = await Highlight.find({ userId })
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json(highlights);
    } catch (error) {
        console.error('[Get User Highlights Error]:', error);
        res.status(500).json({ message: 'Öne çıkanlar alınırken sunucu hatası oluştu.' });
    }
};

// @desc    Delete a highlight
// @route   DELETE /api/stories/highlights/:id
// @access  Private
export const deleteHighlight = async (req, res) => {
    try {
        const highlight = await Highlight.findById(req.params.id);
        if (!highlight) {
            return res.status(404).json({ message: 'Öne çıkan bulunamadı.' });
        }

        const isOwner = highlight.userId.toString() === req.user._id.toString();
        const isAdmin = Boolean(req.user.isAdmin);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Bu öne çıkarılanı silme yetkiniz yok.' });
        }

        await Highlight.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Öne çıkan başarıyla silindi.' });
    } catch (error) {
        console.error('[Delete Highlight Error]:', error);
        res.status(500).json({ message: 'Öne çıkan silinirken sunucu hatası oluştu.' });
    }
};

