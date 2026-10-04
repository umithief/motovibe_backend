import mongoose from 'mongoose';
import PackPost from '../models/PackPost.js';
import Pack from '../models/Pack.js';
import {
    canManagePackAction,
    findPackMember,
    isApprovedMember,
} from '../utils/packMembership.js';

const isValidObjectId = (v = '') => mongoose.Types.ObjectId.isValid(v);

const canModeratePack = (pack, userId) => {
    return canManagePackAction(pack, userId, 'pin');
};

const requirePackFeedReadAccess = async (packId, userId, res) => {
    const pack = await Pack.findById(packId)
        .select('isPrivate isDeleted memberRoles members owner admins joinRequests')
        .lean();
    if (!pack || pack.isDeleted) {
        res.status(404).json({ message: 'Klan bulunamadı.' });
        return null;
    }
    if (pack.isPrivate && !isApprovedMember(pack, userId)) {
        res.status(403).json({ message: 'Özel klan akışı yalnızca onaylı üyelere açıktır.' });
        return null;
    }
    return pack;
};

// @desc    Create a post in a pack feed
// @route   POST /api/packs/:packId/posts
// @access  Private (members only)
export const createPackPost = async (req, res) => {
    try {
        const { packId } = req.params;
        if (!isValidObjectId(packId)) {
            return res.status(400).json({ message: 'Geçersiz Pack ID.' });
        }

        const userId = req.user?._id;
        if (!userId) return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });

        const pack = await Pack.findById(packId)
            .select('isDeleted memberRoles members owner admins joinRequests')
            .lean();
        if (!pack) return res.status(404).json({ message: 'Pack bulunamadı.' });

        if (!isApprovedMember(pack, userId)) {
            return res.status(403).json({ message: 'Sadece üyeler gönderi paylaşabilir.' });
        }

        const content = (req.body.content || '').toString().trim();
        const image = (req.body.image || '').toString().trim();
        const postType = req.body.postType || (image ? 'PHOTO' : 'TEXT');

        if (!content && !image && postType === 'TEXT') {
            return res.status(400).json({ message: 'İçerik veya görsel gerekli.' });
        }

        const isAnnouncement = req.body.isAnnouncement === true;
        const isAdmin = canModeratePack(pack, userId) || (pack.admins || []).some(
            (admin) => admin.toString() === userId.toString(),
        );

        let attachedRoute = req.body.attachedRoute || undefined;
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
            attachedBike: req.body.attachedBike || undefined,
            attachedMap: req.body.attachedMap || undefined,
            isAnnouncement: isAnnouncement && isAdmin,
            isPinned: false,
        });

        const populated = await PackPost.findById(post._id)
            .populate('author', 'name username avatar')
            .lean();

        res.status(201).json(populated);
    } catch (error) {
        console.error('createPackPost error:', error);
        res.status(500).json({ message: 'Gönderi oluşturulamadı.', error: error.message });
    }
};

// @desc    Get pack feed posts
// @route   GET /api/packs/:packId/posts
// @access  Private
export const getPackPosts = async (req, res) => {
    try {
        const { packId } = req.params;
        if (!isValidObjectId(packId)) {
            return res.status(400).json({ message: 'Geçersiz Pack ID.' });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const userId = req.user?._id?.toString() || '';
        const pack = await requirePackFeedReadAccess(packId, userId, res);
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

        res.status(200).json(result);
    } catch (error) {
        console.error('getPackPosts error:', error);
        res.status(500).json({ message: 'Gönderi akışı alınamadı.', error: error.message });
    }
};

// @desc    Toggle like on a pack post
// @route   POST /api/packs/:packId/posts/:postId/like
// @access  Private
export const togglePackPostLike = async (req, res) => {
    try {
        const { packId, postId } = req.params;
        if (!isValidObjectId(postId)) {
            return res.status(400).json({ message: 'Geçersiz Post ID.' });
        }

        const userId = req.user?._id;
        if (!userId) return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });

        const pack = await requirePackFeedReadAccess(packId, userId, res);
        if (!pack || !isApprovedMember(pack, userId)) {
            if (pack) res.status(403).json({ message: 'Beğeni yalnızca klan üyelerine açıktır.' });
            return;
        }

        const post = await PackPost.findOne({ _id: postId, pack: packId })
            .select('likes likeCount')
            .lean();
        if (!post) return res.status(404).json({ message: 'Gönderi bulunamadı.' });

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

        res.status(200).json({ isLiked: !isLiked, likeCount: (post.likeCount || 0) + (isLiked ? -1 : 1) });
    } catch (error) {
        console.error('togglePackPostLike error:', error);
        res.status(500).json({ message: 'Beğeni güncellenemedi.' });
    }
};

// @desc    Add comment to a pack post
// @route   POST /api/packs/:packId/posts/:postId/comment
// @access  Private
export const addPackPostComment = async (req, res) => {
    try {
        const { packId, postId } = req.params;
        if (!isValidObjectId(postId)) {
            return res.status(400).json({ message: 'Geçersiz Post ID.' });
        }

        const userId = req.user?._id;
        if (!userId) return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });

        const pack = await requirePackFeedReadAccess(packId, userId, res);
        if (!pack || !isApprovedMember(pack, userId)) {
            if (pack) res.status(403).json({ message: 'Yorum yalnızca klan üyelerine açıktır.' });
            return;
        }

        const text = (req.body.text || '').toString().trim();
        if (!text) return res.status(400).json({ message: 'Yorum boş olamaz.' });

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

        if (!result) return res.status(404).json({ message: 'Gönderi bulunamadı.' });

        const lastComment = result.comments[result.comments.length - 1];
        res.status(201).json({
            _id: lastComment._id?.toString(),
            text: lastComment.text,
            createdAt: lastComment.createdAt,
            author: lastComment.author || {},
            commentCount: result.commentCount,
        });
    } catch (error) {
        console.error('addPackPostComment error:', error);
        res.status(500).json({ message: 'Yorum eklenemedi.' });
    }
};

// @desc    Delete a pack post
// @route   DELETE /api/packs/:packId/posts/:postId
// @access  Private (author or admin)
export const deletePackPost = async (req, res) => {
    try {
        const { packId, postId } = req.params;
        if (!isValidObjectId(postId)) {
            return res.status(400).json({ message: 'Geçersiz Post ID.' });
        }

        const userId = req.user?._id;
        if (!userId) return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });

        const pack = await requirePackFeedReadAccess(packId, userId, res);
        if (!pack || !isApprovedMember(pack, userId)) {
            if (pack) res.status(403).json({ message: 'Gönderi işlemi yalnızca klan üyelerine açıktır.' });
            return;
        }

        const post = await PackPost.findOne({ _id: postId, pack: packId })
            .select('author pack')
            .lean();
        if (!post) return res.status(404).json({ message: 'Gönderi bulunamadı.' });

        // Check ownership or admin privileges
        const isAuthor = post.author.toString() === userId.toString();
        if (!isAuthor) {
            if (!canModeratePack(pack, userId) && !(pack.admins || []).some(
                (admin) => admin.toString() === userId.toString(),
            )) {
                return res.status(403).json({ message: 'Bu gönderiyi silme yetkiniz yok.' });
            }
        }

        await PackPost.findByIdAndDelete(postId);
        res.status(200).json({ success: true, message: 'Gönderi silindi.' });
    } catch (error) {
        console.error('deletePackPost error:', error);
        res.status(500).json({ message: 'Gönderi silinemedi.' });
    }
};

// @desc    Toggle pin on a pack post (admin only)
// @route   POST /api/packs/:packId/posts/:postId/pin
// @access  Private (admin only)
export const togglePinPackPost = async (req, res) => {
    try {
        const { packId, postId } = req.params;
        if (!isValidObjectId(postId) || !isValidObjectId(packId)) {
            return res.status(400).json({ message: 'Geçersiz ID.' });
        }

        const userId = req.user?._id;
        if (!userId) return res.status(401).json({ message: 'Kimlik doğrulama gerekli.' });

        const pack = await Pack.findById(packId)
            .select('isDeleted owner admins memberRoles members joinRequests isPrivate')
            .lean();
        if (!pack) return res.status(404).json({ message: 'Pack bulunamadı.' });

        if (!isApprovedMember(pack, userId) || (!canModeratePack(pack, userId) && !(pack.admins || []).some(
            (admin) => admin.toString() === userId.toString(),
        ))) {
            return res.status(403).json({ message: 'Sabitleme yetkisi yok.' });
        }

        const post = await PackPost.findOne({ _id: postId, pack: packId }).select('isPinned');
        if (!post) return res.status(404).json({ message: 'Gönderi bulunamadı.' });

        post.isPinned = !post.isPinned;
        await post.save();

        res.status(200).json({ isPinned: post.isPinned });
    } catch (error) {
        console.error('togglePinPackPost error:', error);
        res.status(500).json({ message: 'Sabitleme güncellenemedi.' });
    }
};
