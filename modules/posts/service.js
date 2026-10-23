import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { incrementMetric } from "../achievements/service.js";
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Post from "./model.js";
import User from "../users/model.js";

import AppError from "../../utils/appError.js";
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Comment model
import Comment from "./Comment.model.js";
import { createNotification } from "../notifications/service.js";
import { mergeNormalizedTags, syncTagUsage } from "../../utils/tagUtils.js";
import { escapeRegex, normalizeTagName } from "../../utils/tagUtils.js";
import { extractMentions, notifyTagsAndMentions, sanitizeMediaTags } from "./tagging.service.js";


// Helper: Fetch savedPosts IDs for the current user (since middleware doesn't load them)
const getSavedPostIds = async (userId) => {
    try {
        const u = await User.findById(userId).select('savedPosts').lean();
        return u?.savedPosts ? u.savedPosts.map(id => id.toString()) : [];
    } catch { return []; }
};

const safeRegex = (query) => new RegExp(escapeRegex(query), 'i');

// Get Feed Posts (From Following + Own)
export const getFeedPosts = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const page = parseInt(input.query.page) || 1;
    const limit = parseInt(input.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Fetch following and savedPosts IDs separately
    const userData = await User.findById(input.user.id).select('following savedPosts blockedUsers').lean();
    const followingIds = userData?.following
        ? userData.following.map(id => id.toString()).filter(id => mongoose.Types.ObjectId.isValid(id))
        : [];
    const savedPostIds = userData?.savedPosts
        ? userData.savedPosts.map(id => id.toString()).filter(id => mongoose.Types.ObjectId.isValid(id))
        : [];
    const blockedUserIds = userData?.blockedUsers
        ? userData.blockedUsers.map(id => id.toString()).filter(id => mongoose.Types.ObjectId.isValid(id))
        : [];

    // Allow only followed users and the requesting user's own posts, excluding blocked users
    const currentUserId = input.user.id.toString();
    const allowedUserIds = [...new Set([...followingIds, currentUserId].filter(Boolean))]
        .filter(id => !blockedUserIds.includes(id));

    // If no valid user IDs, return empty feed instead of crashing
    if (!allowedUserIds.length) {
        return respond({
            status: 'success', results: 0, total: 0, page, pages: 0,
            data: { items: [], posts: [], page, hasMore: false }
        },200);
    }

    // 2. Fetch posts strictly from this list
    const posts = await Post.find({
        user: { $in: allowedUserIds },
        isDeleted: { $ne: true },
        type: { $ne: 'reel' }
    })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name username avatar rank isVerified')
        .lean();

    const postsWithStatus = posts.map(post => {
        const { likes: _rawLikes, ...cleanPost } = post;
        return {
            ...cleanPost,
            isLiked: (post.likes || []).some(id => id.toString() === input.user.id.toString()),
            isSaved: savedPostIds.includes(post._id.toString()),
            likesCount: post.likeCount ?? (post.likes ? post.likes.length : 0)
        };
    });

    // Only count if needed for pagination (page 1 can skip if fewer results than limit)
    let total = posts.length + skip;
    if (posts.length >= limit) {
        total = await Post.countDocuments({
            user: { $in: allowedUserIds },
            isDeleted: { $ne: true }
        });
    }

    respond({
        status: 'success',
        results: postsWithStatus.length,
        total,
        page,
        pages: Math.ceil(total / limit),
        data: {
            items: postsWithStatus,
            posts: postsWithStatus,
            page,
            hasMore: skip + postsWithStatus.length < total
        }
    },200);

    return response;
};

export const createPost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { caption, content, tags, media, telemetry, linkedBike, linkedRoute, images, mediaUrl } = input.body;

    // 1. Validation: Ensure caption or media exists
    const hasMedia = (media && media.length > 0) || (images && images.length > 0) || mediaUrl || input.file;
    const postContent = (caption || content || '').toString().trim();
    const normalizedTags = mergeNormalizedTags({ text: postContent, tags });

    if (!postContent && !hasMedia) {
        return throwError(new AppError('Icerik veya medya gereklidir.', 400));
    }

    // 2. Media Handling
    let finalMedia = media || [];
    let finalImages = images || [];

    // Ensure array structures
    if (!Array.isArray(finalMedia)) finalMedia = [];
    if (!Array.isArray(finalImages)) finalImages = [];

    // Handle File Upload (MemoryStorage) - Single or Array via upload.any()
    const uploadToFirebase = async (file) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalName = (file.originalname || 'unknown').replace(/[^a-zA-Z0-9.]/g, '');
        const ext = path.extname(originalName) || (file.mimetype?.startsWith('video') ? '.mp4' : '.png');
        const baseName = `post-${uniqueSuffix}${ext}`;

        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const fileData = file.buffer || fs.readFileSync(file.path);
        const destPath = path.join(uploadsDir, baseName);
        fs.writeFileSync(destPath, fileData);

        return `uploads/${baseName}`;
    };

    if (input.files && input.files.length > 0) {
        for (const file of input.files) {
            const fileUrl = await uploadToFirebase(file);
            const type = file.mimetype?.startsWith('video') ? 'VIDEO' : 'IMAGE';
            finalMedia.push({
                url: fileUrl,
                type: type,
                isHudOverlayActive: false
            });
            if (type === 'IMAGE') {
                finalImages.push(fileUrl);
            }
        }
    } else if (input.file) {
        const fileUrl = await uploadToFirebase(input.file);
        const type = input.file.mimetype?.startsWith('video') ? 'VIDEO' : 'IMAGE';
        finalMedia.push({
            url: fileUrl,
            type: type,
            isHudOverlayActive: false
        });
        if (type === 'IMAGE') {
            finalImages.push(fileUrl);
        }
    }

    // Legacy compatibility: Map 'mediaUrl' string
    if (mediaUrl && typeof mediaUrl === 'string') {
        const type = mediaUrl.match(/\.(mp4|mov|webm)$/i) ? 'VIDEO' : 'IMAGE';

        // Add to media if not exists
        if (!finalMedia.some(m => m.url === mediaUrl)) {
            finalMedia.push({ url: mediaUrl, type: type });
        }

        // Add to images if it's an image
        if (type === 'IMAGE' && !finalImages.includes(mediaUrl)) {
            finalImages.push(mediaUrl);
        }
    }

    // Bi-directional sync: Ensure all 'media' images are in 'images' array
    finalMedia.forEach(m => {
        if (m.type === 'IMAGE' && m.url && !finalImages.includes(m.url)) {
            finalImages.push(m.url);
        }
    });

    // Bi-directional sync: Ensure all 'images' string URLs are in 'media' array
    finalImages.forEach(url => {
        if (!finalMedia.some(m => m.url === url)) {
            finalMedia.push({ url: url, type: 'IMAGE' });
        }
    });

    // 3. Create the Post Document
    const cleanLinkedBike = mongoose.Types.ObjectId.isValid(linkedBike) ? linkedBike : undefined;
    const cleanLinkedRoute = mongoose.Types.ObjectId.isValid(linkedRoute) ? linkedRoute : undefined;

    const [mediaTags, mentions] = await Promise.all([
        sanitizeMediaTags(input.body.mediaTags, { author: input.user, mediaCount: finalMedia.length }),
        extractMentions(postContent, { excludeUserId: input.user.id })
    ]);

    const newPost = await Post.create({
        user: input.user.id,
        userName: input.user.name,
        userAvatar: input.user.avatar,
        userRank: input.user.rank,
        caption: postContent,
        content: postContent, // Keep sync
        tags: normalizedTags,
        media: finalMedia,
        images: finalImages, // Explicitly save legacy array for frontend compatibility
        mediaTags,
        mentions,

        // Map Telemetry
        telemetry: telemetry ? {
            speed: telemetry.speed,
            leanAngle: telemetry.leanAngle,
            gForce: telemetry.gForce,
            locationLabel: telemetry.locationLabel || telemetry.location,
            distance: telemetry.distance
        } : undefined,

        // Map older rideStats if telemetry provided for backward compat
        rideStats: telemetry ? {
            maxSpeed: telemetry.speed,
            leanAngle: telemetry.leanAngle,
            distance: telemetry.distance
        } : undefined,

        linkedBike: cleanLinkedBike,
        linkedRoute: cleanLinkedRoute,
        location: telemetry?.locationLabel || input.body.location
    });

    await syncTagUsage({ previousTags: [], nextTags: normalizedTags });

    notifyTagsAndMentions({
        actorId: input.user.id,
        postId: newPost._id,
        taggedIds: mediaTags.map((tag) => tag.taggedUser),
        mentionIds: mentions
    }).catch((error) => console.warn('[CyberLens] notify failed:', error.message));

    // 4. Update Linked Bike Mileage (Optional Micro-feature)
    if (linkedBike && telemetry?.distance) {
        try {
            // Try to find the bike model if it exists
            const Bike = mongoose.models.Bike;
            if (Bike) {
                await Bike.findByIdAndUpdate(linkedBike, {
                    $inc: { mileage: telemetry.distance }
                });
            }
        } catch (error) {
            console.warn("Failed to update bike mileage:", error.message);
        }
    }

    // 5. Populate References
    await newPost.populate('user', 'name avatar rank');
    if (mongoose.models.Bike) await newPost.populate('linkedBike');
    if (mongoose.models.Route) await newPost.populate('linkedRoute');

    // 6. Return Response
    respond({
        success: true,
        status: 'success',
        message: "Sürüş kaydı başarıyla paylaşıldı.",
        data: { post: newPost }
    },201);

    return response;
};

export const toggleLike = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    if (input.params.id?.startsWith('re:')) {
        return throwError(new AppError('Reel etkileşimi için /reels/:id/interact kullanılmalıdır.', 400));
    }

    const post = await Post.findById(input.params.id);

    if (!post) {
        return throwError(new AppError('Post bulunamadı.', 404));
    }

    // Check if like exists
    const isLiked = post.likes.some(id => id.toString() === input.user.id.toString());

    if (isLiked) {
        // Unlike
        post.likes.pull(input.user.id);
        post.likeCount = Math.max(0, post.likeCount - 1);
    } else {
        // Like
        post.likes.push(input.user.id);
        post.likeCount += 1;

        // Notify Post Owner (if not self)
        if (post.user.toString() !== input.user.id.toString()) {
            await createNotification({
                recipient: post.user,
                sender: input.user.id,
                type: 'LIKE',
                post: post._id
            });
        }
    }

    await post.save();
    incrementMetric(input.user.id, 'uniqueInteractions', 1).catch(err => console.error(err));

    respond({
        status: 'success',
        message: isLiked ? 'Beğeni geri alındı' : 'Beğenildi',
        data: {
            likes: post.likes,
            likeCount: post.likeCount
        }
    },200);

    return response;
};

export const savePost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    if (input.params.id?.startsWith('re:')) {
        return throwError(new AppError('Reel kaydetme için /reels/:id/interact kullanılmalıdır.', 400));
    }

    const post = await Post.findById(input.params.id);

    if (!post) {
        return throwError(new AppError('Post bulunamadı.', 404));
    }

    // Check if already saved using helper
    const savedPostIds = await getSavedPostIds(input.user.id);
    const isSaved = savedPostIds.includes(post._id.toString());

    if (isSaved) {
        // Unsave — atomic pull
        await User.findByIdAndUpdate(input.user.id, { $pull: { savedPosts: post._id } });
    } else {
        // Save — atomic addToSet
        await User.findByIdAndUpdate(input.user.id, { $addToSet: { savedPosts: post._id } });
    }

    respond({
        status: 'success',
        message: isSaved ? 'Kaydedilenlerden çıkarıldı' : 'Kaydedildi',
        data: {
            isSaved: !isSaved
        }
    },200);

    return response;
};

export const addComment = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { content } = input.body;
    const commentContent = (content || '').toString().trim();
    const post = await Post.findById(input.params.id);

    if (!post) return throwError(new AppError('Post bulunamadı.', 404));
    if (!commentContent) return throwError(new AppError('Yorum boş olamaz', 400));

    const mentions = await extractMentions(commentContent, { excludeUserId: input.user.id });
    const newComment = await Comment.create({
        content: commentContent,
        author: input.user.id,
        post: post._id,
        mentions
    });

    // Update post meta
    post.commentCount += 1;
    await post.save();
    incrementMetric(input.user.id, 'uniqueInteractions', 1).catch(err => console.error(err));

    await syncTagUsage({
        previousTags: [],
        nextTags: mergeNormalizedTags({ text: commentContent })
    });

    // Populate for return
        await newComment.populate('author', 'name avatar');

    // Notify Post Owner (if not self)
    if (post.user.toString() !== input.user.id.toString()) {
        await createNotification({
            recipient: post.user,
            sender: input.user.id,
            type: 'COMMENT',
            post: post._id,
            commentId: newComment._id
        });
    }

    // The post owner already gets COMMENT; don't double-notify them for a mention.
    notifyTagsAndMentions({
        actorId: input.user.id,
        postId: post._id,
        commentId: newComment._id,
        mentionIds: mentions.filter((id) => String(id) !== String(post.user)),
        mentionType: 'MENTIONED_IN_COMMENT'
    }).catch((error) => console.warn('[CyberLens] notify failed:', error.message));

    respond({
        status: 'success',
        message: 'Yorum eklendi',
        data: { comment: newComment }
    },201);

    return response;
};

export const getPostComments = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { id } = input.params;

    const page = parseInt(input.query.page) || 1;
    const limit = parseInt(input.query.limit) || 20;
    const skip = (page - 1) * limit;

    const comments = await Comment.find({ post: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('author', 'name avatar isVerified')
        .lean();

    const totalComments = await Comment.countDocuments({ post: id });
    const hasMore = skip + comments.length < totalComments;

    respond({
        status: 'success',
        results: comments.length,
        data: { comments }
    },200);

    return response;
};

export const updateComment = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { content } = input.body;
    const { commentId } = input.params;
    const nextContent = (content || '').toString().trim();

    if (!nextContent) return throwError(new AppError('Yorum bo� olamaz', 400));

    const comment = await Comment.findById(commentId);
    if (!comment) return throwError(new AppError('Yorum bulunamad�.', 404));

    if (comment.author.toString() !== input.user.id.toString() && !input.user.isAdmin) {
        return throwError(new AppError('Bu yorumu d�zenlemeye yetkiniz yok.', 403));
    }

    const previousContent = comment.content || '';
    comment.content = nextContent;
    await comment.save();

    await syncTagUsage({
        previousTags: mergeNormalizedTags({ text: previousContent }),
        nextTags: mergeNormalizedTags({ text: nextContent })
    });

    await comment.populate('author', 'name avatar isVerified');

    respond({
        status: 'success',
        message: 'Yorum güncellendi',
        data: { comment }
    },200);

    return response;
};

export const deleteComment = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { commentId } = input.params;

    const comment = await Comment.findById(commentId);
    if (!comment) return throwError(new AppError('Yorum bulunamadı.', 404));

    if (comment.author.toString() !== input.user.id.toString() && !input.user.isAdmin) {
        return throwError(new AppError('Bu yorumu silmeye yetkiniz yok.', 403));
    }

    const postId = comment.post;
    const previousCommentContent = comment.content || '';
    await Comment.findByIdAndDelete(commentId);

    // Update post meta count
    await Post.findByIdAndUpdate(postId, { $inc: { commentCount: -1 } });
    await syncTagUsage({
        previousTags: mergeNormalizedTags({ text: previousCommentContent }),
        nextTags: []
    });

    respond({
        status: 'success',
        data: null
    },204);

    return response;
};


export const getUserPosts = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const userId = input.params.id;
    const page = parseInt(input.query.page) || 1;
    const limit = parseInt(input.query.limit) || 20;
    const skip = (page - 1) * limit;

    const posts = await Post.find({ user: userId, isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name username avatar rank isVerified')
        .lean();

    // Calculate isLiked if user is authenticated
    let postsWithStatus = posts;
    if (input.user) {
        const savedPostIds = await getSavedPostIds(input.user.id);
        postsWithStatus = posts.map(post => ({
            ...post,
            isLiked: post.likes.some(id => id.toString() === input.user.id.toString()),
            isSaved: savedPostIds.includes(post._id.toString())
        }));
    }

    // Only count if needed
    let total = posts.length + skip;
    if (posts.length >= limit) {
        total = await Post.countDocuments({ user: userId, isDeleted: { $ne: true } });
    }

    respond({
        status: 'success',
        results: postsWithStatus.length,
        total,
        page,
        pages: Math.ceil(total / limit),
        data: {
            items: postsWithStatus,
            posts: postsWithStatus,
            page,
            hasMore: skip + postsWithStatus.length < total
        }
    },200);

    return response;
};

export const getPostById = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    if (!mongoose.Types.ObjectId.isValid(input.params.id)) {
        return throwError(new AppError('Post bulunamadı.', 404));
    }

    const post = await Post.findById(input.params.id)
        .populate('user', 'name username avatar rank isVerified bikeModel')
        .populate('linkedBike', 'brand model year cc image')
        .populate('linkedRoute', 'title distance difficulty duration')
        .lean();

    if (!post || post.isDeleted) {
        return throwError(new AppError('Post bulunamadı.', 404));
    }

    let isLiked = false;
    let isSaved = false;

    if (input.user) {
        const savedPostIds = await getSavedPostIds(input.user.id);
        isLiked = (post.likes || []).some(id => id.toString() === input.user.id.toString());
        isSaved = savedPostIds.includes(post._id.toString());
    }

    const { likes: _rawLikes, ...cleanPost } = post;
    const postWithStatus = {
        ...cleanPost,
        isLiked,
        isSaved,
        likesCount: post.likeCount ?? (post.likes ? post.likes.length : 0),
        commentsCount: post.commentCount ?? 0,
        userName: post.user?.name || post.user?.username || post.userName || 'Motonom Pilotu',
        userAvatar: post.user?.avatar || post.userAvatar || '',
        userRank: post.user?.rank || post.userRank || 'Üye',
        isUserVerified: post.user?.isVerified ?? post.isUserVerified ?? false,
        bikeModel: post.linkedBike ? `${post.linkedBike.brand} ${post.linkedBike.model}` : (post.bikeModel || post.user?.bikeModel)
    };

    respond({
        status: 'success',
        data: { post: postWithStatus }
    },200);

    return response;
};

export const getPostStreamFeed = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { id } = input.params;
    const page = parseInt(input.query.page) || 1;
    const limit = Math.min(parseInt(input.query.limit) || 10, 30);
    const cursor = input.query.cursor ? new Date(input.query.cursor) : null;
    const beforeId = input.query.beforeId;
    const skip = (page - 1) * limit;

    // 1. Validate ObjectId (prevent re: or invalid ids from falling through)
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return throwError(new AppError('Geçersiz gönderi kimliği.', 400));
    }

    // 2. Fetch saved posts and blocked users
    let savedPostIds = [];
    let blockedUserIds = [];
    if (input.user) {
        const [userData, usersBlockingMe] = await Promise.all([
            User.findById(input.user.id).select('savedPosts blockedUsers').lean(),
            User.find({ blockedUsers: input.user.id }).select('_id').lean()
        ]);
        if (userData?.savedPosts) {
            savedPostIds = userData.savedPosts
                .map(sid => sid.toString())
                .filter(sid => mongoose.Types.ObjectId.isValid(sid));
        }
        const myBlocked = (userData?.blockedUsers || []).map(b => b.toString());
        const theyBlocked = (usersBlockingMe || []).map(u => u._id.toString());
        blockedUserIds = [...new Set([...myBlocked, ...theyBlocked])]
            .filter(bid => mongoose.Types.ObjectId.isValid(bid));
    }

    // Format post and strip likes[] array to prevent user ID leakage
    const formatPost = (p) => {
        if (!p) return null;
        const liked = input.user ? (p.likes || []).some(uid => uid.toString() === input.user.id.toString()) : false;
        const saved = input.user ? savedPostIds.includes(p._id.toString()) : false;
        const { likes: _rawLikes, ...cleanPost } = p;
        return {
            ...cleanPost,
            isLiked: liked,
            isSaved: saved,
            likesCount: p.likeCount ?? (p.likes ? p.likes.length : 0),
            commentsCount: p.commentCount ?? 0,
            userName: p.user?.name || p.user?.username || p.userName || 'Motonom Pilotu',
            userAvatar: p.user?.avatar || p.userAvatar || '',
            userRank: p.user?.rank || p.userRank || 'Üye',
            isUserVerified: p.user?.isVerified ?? p.isUserVerified ?? false,
            bikeModel: p.linkedBike ? `${p.linkedBike.brand} ${p.linkedBike.model}` : (p.bikeModel || p.user?.bikeModel)
        };
    };

    // 3. Find target post
    const targetPost = await Post.findById(id)
        .populate('user', 'name username avatar rank isVerified bikeModel')
        .populate('linkedBike', 'brand model year cc image')
        .populate('linkedRoute', 'title distance difficulty duration')
        .lean();

    if (!targetPost || targetPost.isDeleted) {
        return throwError(new AppError('Hedef gönderi bulunamadı.', 404));
    }

    const targetAuthorId = targetPost.user?._id?.toString() || targetPost.user?.toString();
    if (targetAuthorId && blockedUserIds.includes(targetAuthorId)) {
        return throwError(new AppError('Bu gönderiye erişiminiz bulunmuyor.', 403));
    }

    if (page === 1 && !cursor) {
        const remainingLimit = limit - 1;
        const subsequentPosts = await Post.find({
            _id: { $ne: targetPost._id },
            user: { $nin: blockedUserIds },
            createdAt: { $lte: targetPost.createdAt },
            isDeleted: { $ne: true }
        })
        .sort({ createdAt: -1 })
        .limit(remainingLimit)
        .populate('user', 'name username avatar rank isVerified bikeModel')
        .populate('linkedBike', 'brand model year cc image')
        .populate('linkedRoute', 'title distance difficulty duration')
        .lean();

        const combined = [targetPost, ...subsequentPosts].map(formatPost).filter(Boolean);
        const lastItem = combined.length > 0 ? combined[combined.length - 1] : null;

        return respond({
            status: 'success',
            results: combined.length,
            data: {
                items: combined,
                posts: combined,
                page: 1,
                hasMore: subsequentPosts.length >= remainingLimit,
                nextCursor: lastItem?.createdAt ? new Date(lastItem.createdAt).toISOString() : null,
                lastId: lastItem?._id ? lastItem._id.toString() : null
            }
        },200);
    }

    // Subsequent pages: filter blocked users and maintain chronological stream with cursor or skip
    let query = {
        user: { $nin: blockedUserIds },
        isDeleted: { $ne: true }
    };

    const hasValidCursor = cursor && !isNaN(cursor.getTime());
    if (hasValidCursor) {
        query.createdAt = { $lt: cursor };
        if (beforeId && mongoose.Types.ObjectId.isValid(beforeId)) {
            query._id = { $ne: new mongoose.Types.ObjectId(beforeId) };
        }
    } else {
        query._id = { $ne: targetPost._id };
        query.createdAt = { $lt: targetPost.createdAt };
    }

    const postQuery = Post.find(query).sort({ createdAt: -1 });
    if (!hasValidCursor) {
        postQuery.skip(skip);
    }

    const posts = await postQuery
        .limit(limit)
        .populate('user', 'name username avatar rank isVerified bikeModel')
        .populate('linkedBike', 'brand model year cc image')
        .populate('linkedRoute', 'title distance difficulty duration')
        .lean();

    const formatted = posts.map(formatPost).filter(Boolean);
    const lastItem = formatted.length > 0 ? formatted[formatted.length - 1] : null;

    respond({
        status: 'success',
        results: formatted.length,
        data: {
            items: formatted,
            posts: formatted,
            page,
            hasMore: formatted.length >= limit,
            nextCursor: lastItem?.createdAt ? new Date(lastItem.createdAt).toISOString() : null,
            lastId: lastItem?._id ? lastItem._id.toString() : null
        }
    },200);

    return response;
};

export const search = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { q } = input.query;
    const queryText = q?.toString().trim() || '';

    if (!queryText) {
        return throwError(new AppError('Arama terimi gereklidir.', 400));
    }

    const regex = safeRegex(queryText);

    // Run search queries in parallel for performance
    const [users, rides, routes, reels, posts, hashtags] = await Promise.all([
        User.find({
            $or: [
                { name: regex },
                { username: regex }
            ]
        }).select('name username avatar profileImage bike rank').limit(10).lean(),

        mongoose.model('Ride').find({
            $or: [
                { title: regex },
                { description: regex },
                { startLocation: regex }
            ]
        }).populate('creator', 'name avatar').limit(10).lean(),

        mongoose.model('Route').find({
            $or: [
                { title: regex },
                { location: regex },
                { tags: { $in: [regex] } }
            ]
        }).limit(10).lean(),

        mongoose.model('Reel').find({
            $or: [
                { caption: regex },
                { tags: regex }
            ]
        }).limit(10).lean(),

        mongoose.model('SocialPost').find({
            $or: [
                { caption: regex },
                { content: regex },
                { tags: regex }
            ]
        }).limit(10).sort({ createdAt: -1 }).lean(),

        mongoose.model('Tag').find({
            $or: [
                { name: regex },
                { displayName: regex }
            ]
        }).sort({ postCount: -1 }).limit(15).lean()
    ]);

    respond({
        status: 'success',
        users,
        rides,
        routes,
        reels,
        posts,
        hashtags
    },200);

    return response;
};

export const deletePost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const post = await Post.findById(input.params.id);

    if (!post) {
        return throwError(new AppError('Post bulunamadı.', 404));
    }

    // Check if user is owner or admin (optional admin override)
    if (post.user.toString() !== input.user.id.toString() && !input.user.isAdmin) {
        return throwError(new AppError('Bu işlemi yapmaya yetkiniz yok.', 403));
    }

    // --- File Cleanup Logic ---
    const mediaToPool = [...(post.media || []), ...(post.images || []).map(url => ({ url }))];
    const uniqueFiles = [...new Set(mediaToPool.map(m => {
        if (!m.url) return null;
        if (m.url.includes('/uploads/')) return m.url.split('/uploads/').pop();
        return null;
    }).filter(Boolean))];

    uniqueFiles.forEach(async (filename) => {
        if (filename.includes('storage.googleapis.com') || filename.startsWith('post-')) {
            const pathMatch = filename.match(/uploads\/.*$/) || ['uploads/' + filename];
            if (pathMatch && pathMatch[0]) {
                const bucket = admin.storage().bucket();
                try {
                    await bucket.file(pathMatch[0]).delete();
                    console.log('[Cleanup] Deleted from Firebase:', pathMatch[0]);
                } catch (err) {
                    console.error('[Cleanup] Failed to delete from Firebase:', pathMatch[0]);
                }
            }
        } else {
            const filePath = path.join(__dirname, '../../uploads/', filename);
            fs.unlink(filePath, (err) => {
                if (err) console.error('[Cleanup] Failed to delete file:', filename, err.message);
            });
        }
    });

    await syncTagUsage({
        previousTags: post.tags || [],
        nextTags: []
    });

    await Post.findByIdAndDelete(input.params.id);

    respond({
        status: 'success',
        data: null
    },204);

    return response;
};

export const updatePost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { content, caption, tags } = input.body;
    const post = await Post.findById(input.params.id);

    if (!post) {
        return throwError(new AppError('Post bulunamad�.', 404));
    }

    if (post.user.toString() !== input.user.id.toString()) {
        return throwError(new AppError('Bu i�lemi yapmaya yetkiniz yok.', 403));
    }

    const nextContentRaw = caption ?? content ?? post.content ?? post.caption ?? '';
    const nextContent = nextContentRaw.toString().trim();

    if (!nextContent && !(post.media || []).length && !(post.images || []).length) {
        return throwError(new AppError('Icerik veya medya gereklidir.', 400));
    }

    const previousTags = post.tags || [];
    const nextTags = mergeNormalizedTags({
        text: nextContent,
        tags: tags ?? []
    });

    const previousMentions = new Set((post.mentions || []).map(String));
    const previousTagged = new Set((post.mediaTags || []).map((tag) => String(tag.taggedUser)));
    const nextMentions = await extractMentions(nextContent, { excludeUserId: input.user.id });

    post.content = nextContent;
    post.caption = nextContent;
    post.tags = nextTags;
    post.mentions = nextMentions;
    if (input.body.mediaTags !== undefined) {
        post.mediaTags = await sanitizeMediaTags(input.body.mediaTags, {
            author: input.user,
            mediaCount: (post.media || []).length
        });
    }

    await post.save();

    notifyTagsAndMentions({
        actorId: input.user.id,
        postId: post._id,
        taggedIds: post.mediaTags.map((tag) => String(tag.taggedUser)).filter((id) => !previousTagged.has(id)),
        mentionIds: nextMentions.filter((id) => !previousMentions.has(String(id)))
    }).catch((error) => console.warn('[CyberLens] notify failed:', error.message));
    incrementMetric(input.user.id, 'uniqueInteractions', 1).catch(err => console.error(err));
    await syncTagUsage({
        previousTags,
        nextTags
    });

    respond({
        status: 'success',
        data: { post }
    },200);

    return response;
};




export const getSavedPosts = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const page = parseInt(input.query.page) || 1;
    const limit = parseInt(input.query.limit) || 10;
    const skip = (page - 1) * limit;

    const savedPostIds = await getSavedPostIds(input.user.id);
    if (!savedPostIds.length) {
        return respond({ status: 'success', results: 0, total: 0, page, pages: 0, data: { posts: [] } },200);
    }

    const posts = await Post.find({ _id: { $in: savedPostIds }, isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    // metadata
    const postsWithStatus = posts.map(post => ({
        ...post,
        isLiked: post.likes.some(id => id.toString() === input.user.id.toString()),
        isSaved: true
    }));

    const total = await Post.countDocuments({ _id: { $in: savedPostIds }, isDeleted: { $ne: true } });

    respond({
        status: 'success',
        results: postsWithStatus.length,
        total,
        page,
        pages: Math.ceil(total / limit),
        data: {
            items: postsWithStatus,
            posts: postsWithStatus,
            page,
            hasMore: skip + postsWithStatus.length < total
        }
    },200);

    return response;
};

export const getTaggedPosts = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const userId = input.params.id;
    const page = parseInt(input.query.page) || 1;
    const limit = parseInt(input.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const targetUser = await User.findById(userId).select('username').lean();
    let searchTerms = [userId];
    if (targetUser && targetUser.username) {
        searchTerms.push(targetUser.username);
    }

    // Spatial tags (approved only) + legacy string tags.
    const taggedFilter = {
        $or: [
            { mediaTags: { $elemMatch: { taggedUser: new mongoose.Types.ObjectId(userId), isApproved: true } } },
            { tags: { $in: searchTerms } }
        ],
        isDeleted: { $ne: true }
    };

    const posts = await Post.find(taggedFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name username avatar rank isVerified')
        .lean();

    const total = await Post.countDocuments(taggedFilter);

    // Calculate isLiked if user is authenticated
    let postsWithStatus = posts;
    if (input.user) {
        const savedPostIds = await getSavedPostIds(input.user.id);
        postsWithStatus = posts.map(post => ({
            ...post,
            isLiked: post.likes.some(id => id.toString() === input.user.id.toString()),
            isSaved: savedPostIds.includes(post._id.toString())
        }));
    }

    respond({
        status: 'success',
        results: postsWithStatus.length,
        total,
        page,
        pages: Math.ceil(total / limit),
        data: { posts: postsWithStatus }
    },200);

    return response;
};

export const getPostsByTag = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { tag } = input.params;
    const page = parseInt(input.query.page) || 1;
    const limit = parseInt(input.query.limit) || 20;
    const skip = (page - 1) * limit;
    const normalizedTag = normalizeTagName(tag);

    if (!normalizedTag) {
        return throwError(new AppError('Geçersiz etiket.', 400));
    }

    // Search in content for #tag
    // We use regex to ensure it matches as a hashtag
    const tagRegex = new RegExp(`(?:\\s|^)#${escapeRegex(normalizedTag)}(?=\\s|$)`, 'i');

    const posts = await Post.find({
        isDeleted: { $ne: true },
        $or: [
            { content: { $regex: tagRegex } },
            { tags: normalizedTag },
            { tags: `#${normalizedTag}` }
        ]
    })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name username avatar rank isVerified')
        .lean();

    let postsWithStatus = posts;
    if (input.user) {
        const userData = await User.findById(input.user.id).select('savedPosts').lean();
        const savedPostIds = userData?.savedPosts ? userData.savedPosts.map(id => id.toString()) : [];

        postsWithStatus = posts.map(post => ({
            ...post,
            isLiked: post.likes.some(id => id.toString() === input.user.id.toString()),
            isSaved: savedPostIds.includes(post._id.toString())
        }));
    }

    const total = await Post.countDocuments({
        isDeleted: { $ne: true },
        $or: [
            { content: { $regex: tagRegex } },
            { tags: normalizedTag },
            { tags: `#${normalizedTag}` }
        ]
    });

    respond({
        status: 'success',
        results: postsWithStatus.length,
        total,
        page,
        pages: Math.ceil(total / limit),
        data: { posts: postsWithStatus }
    },200);

    return response;
};
