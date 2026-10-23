import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Reel from "./model.js";
import ReelComment from "./ReelComment.model.js";
import Route from "../routes/model.js";
import User from "../users/model.js";
import { createNotification } from "../notifications/service.js";
import { notifyTextMentions } from "../notifications/mention.service.js";
import AppError from "../../utils/appError.js";

import redis from "../../config/redis.js";
import { mergeNormalizedTags, syncTagUsage } from "../../utils/tagUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_REEL_LIMIT = 12;
const MAX_REEL_LIMIT = 30;
const DEFAULT_COMMENT_LIMIT = 50;
const MAX_COMMENT_LIMIT = 200;
const VIEW_THROTTLE_WINDOW_MS = 30 * 1000;

const interactionTypes = new Set(['like', 'view', 'share', 'save']);
const viewThrottleCache = new Map();

const parsePositiveInt = (raw, fallback, max) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parseCursor = (cursorRaw) => {
  if (!cursorRaw || typeof cursorRaw !== 'string') return null;
  const [msRaw, id] = cursorRaw.split('_');
  if (!msRaw || !id) return null;

  const ms = Number.parseInt(msRaw, 10);
  if (!Number.isFinite(ms) || !mongoose.Types.ObjectId.isValid(id)) return null;

  const createdAt = new Date(ms);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
};

const encodeCursor = (doc) => {
  if (!doc?.createdAt || !doc?._id) return null;
  const time = new Date(doc.createdAt).getTime();
  return `${time}_${doc._id.toString()}`;
};

const parseJsonField = (raw, fieldName) => {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return raw;
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new AppError(`${fieldName} formati geçersiz.`, 400);
  }
};

export const ALLOWED_VIDEO_HOSTNAMES = new Set([
  'motovibe.app',
  'api.motovibe.app',
  'cdn.motovibe.app',
  'motonom.app',
  'api.motonom.app',
  'cdn.motonom.app',
  '31.210.36.57',
  'localhost',
  '127.0.0.1',
  '10.0.2.2',
]);

export const isValidVideoStorageUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('uploads/') || trimmed.startsWith('/uploads/')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (ALLOWED_VIDEO_HOSTNAMES.has(hostname)) {
      return true;
    }
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname)) {
      return true;
    }
    for (const envVar of [process.env.BASE_URL, process.env.CDN_URL, process.env.BACKEND_URL]) {
      if (envVar) {
        try {
          const envHost = new URL(envVar).hostname.toLowerCase();
          if (hostname === envHost) return true;
        } catch (_) {}
      }
    }
    return false;
  } catch (_) {
    return false;
  }
};

const cleanupUploadedFile = async (fileName) => {
  if (!fileName) return;
  const filePath = path.join(__dirname, '../../uploads/', fileName);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error(`[Cleanup] Failed to delete ${fileName}:`, err.message);
    }
  }
};

const getViewerKey = ({ userId, sessionId, ip, reelId }) => {
  const rawKey = userId || sessionId || ip;
  if (!rawKey) return null;
  return `${reelId}:${rawKey}`;
};

const shouldCountView = async (key) => {
  if (!key) return true;

  try {
    const rawClient = redis?.raw;
    if (rawClient && (rawClient.status === 'ready' || rawClient.status === 'connect')) {
      const redisKey = `throttle:reel:view:${key}`;
      const result = await rawClient.set(redisKey, '1', 'EX', 30, 'NX');
      return result === 'OK';
    }
  } catch (_) {
    // Fallback gracefully to in-memory cache
  }

  const now = Date.now();
  const previousTs = viewThrottleCache.get(key);
  if (previousTs && now - previousTs < VIEW_THROTTLE_WINDOW_MS) {
    return false;
  }

  viewThrottleCache.set(key, now);

  if (viewThrottleCache.size > 10000) {
    const cutoff = now - VIEW_THROTTLE_WINDOW_MS * 2;
    for (const [cacheKey, ts] of viewThrottleCache.entries()) {
      if (ts < cutoff) {
        viewThrottleCache.delete(cacheKey);
      }
    }
  }

  return true;
};

const attachViewerFlags = async (reels, userId) => {
  const cleanUserId = userId ? userId.toString() : '';
  let savedSet = new Set();
  if (cleanUserId) {
    const user = await User.findById(cleanUserId).select('savedReels').lean();
    savedSet = new Set((user?.savedReels || []).map((id) => id.toString()));
  }

  return reels.map((reel) => {
    const likedBy = Array.isArray(reel.likedBy) ? reel.likedBy : [];
    const reelId = reel._id?.toString?.() || reel.id?.toString?.() || '';
    const isLiked = cleanUserId ? likedBy.map(String).includes(cleanUserId) : false;
    const isSaved = cleanUserId ? savedSet.has(reelId) : false;

    // Strip likedBy so user IDs array is never leaked to the client
    const { likedBy: _omittedLikedBy, ...rest } = reel;

    return {
      ...rest,
      isLiked,
      isSaved,
    };
  });
};

export const createReel = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const {
    caption,
    bikeModel,
    telemetry,
    tags,
    location,
    linkedRouteId,
    allowComments,
    isPublic,
    videoUrl: bodyVideoUrl,
    thumbnailUrl: bodyThumbnailUrl,
    thumbnailWidth,
    thumbnailHeight,
    thumbnailAspectRatio,
  } = input.body;
  const userId = input.user.id;

  const videoFile = input.files?.video?.[0];
  const thumbnailFile = input.files?.thumbnail?.[0];

  if (!videoFile && !bodyVideoUrl) {
    return throwError(new AppError('Video dosyasi gerekli.', 400));
  }

  if (bodyVideoUrl && typeof bodyVideoUrl === 'string') {
    if (!isValidVideoStorageUrl(bodyVideoUrl)) {
      return throwError(new AppError('Geçersiz veya yetkilendirilmemiş video URL kaynağı.', 400));
    }
  }

  const user = await User.findById(userId).lean();
  if (!user) {
    return throwError(new AppError('Kullanıcı bulunamadı.', 404));
  }

  // Primary contract: FE uploads via generic UploadService and provides body videoUrl
  // Legacy / fallback: Multi-part video file upload saved to local uploads directory
  const saveLocalFile = async (file) => {
    if (!file) return null;
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const originalName = (file.originalname || 'unknown').replace(/[^a-zA-Z0-9.]/g, '');
    const ext = path.extname(originalName) || (file.mimetype?.startsWith('video') ? '.mp4' : '.png');
    const baseName = `reel-${uniqueSuffix}${ext}`;

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const fileData = file.buffer || fs.readFileSync(file.path);
    const destPath = path.join(uploadsDir, baseName);
    fs.writeFileSync(destPath, fileData);

    return `uploads/${baseName}`;
  };

  const videoUrl = videoFile ? await saveLocalFile(videoFile) : bodyVideoUrl;
  const thumbnailUrl = thumbnailFile ? await saveLocalFile(thumbnailFile) : bodyThumbnailUrl;

  const parsedTags = parseJsonField(tags, 'tags');
  const parsedTelemetry = parseJsonField(telemetry, 'telemetry');
  const cleanCaption = typeof caption === 'string' ? caption.trim() : '';
  const normalizedTags = mergeNormalizedTags({
    text: cleanCaption,
    tags: Array.isArray(parsedTags) ? parsedTags : [],
  });

  const parsedAllowComments = typeof allowComments !== 'undefined'
    ? (allowComments === true || allowComments === 'true' || allowComments === 1 || allowComments === '1')
    : true;
  const parsedIsPublic = typeof isPublic !== 'undefined'
    ? (isPublic === true || isPublic === 'true' || isPublic === 1 || isPublic === '1')
    : true;

  // Moderation Policy:
  // - Verified accounts and admins auto-approved.
  // - General uploads auto-approved unless REEL_AUTO_APPROVE is explicitly 'false' (configurable moderation queue).
  const isAutoApproved = Boolean(
    user.isVerified ||
    user.role === 'admin' ||
    user.isAdmin === true ||
    process.env.REEL_AUTO_APPROVE !== 'false'
  );

  const newReel = await Reel.create({
    userId: userId.toString(),
    userName: user.name,
    userAvatar: user.avatar || user.image,
    videoUrl: videoUrl,
    thumbnailUrl: thumbnailUrl,
    thumbnailWidth,
    thumbnailHeight,
    thumbnailAspectRatio,
    caption: cleanCaption,
    bikeModel: typeof bikeModel === 'string' ? bikeModel.trim() : undefined,
    tags: normalizedTags,
    location: typeof location === 'string' ? location.trim() : undefined,
    linkedRouteId: typeof linkedRouteId === 'string' && linkedRouteId.trim() ? linkedRouteId.trim() : undefined,
    allowComments: parsedAllowComments,
    isPublic: parsedIsPublic,
    telemetry:
      parsedTelemetry && typeof parsedTelemetry === 'object'
        ? parsedTelemetry
        : undefined,
    isApproved: isAutoApproved,
  });

  await syncTagUsage({ previousTags: [], nextTags: normalizedTags });

  if (newReel.isPublic !== false) {
    notifyTextMentions({
      text: cleanCaption,
      actorId: userId,
      type: 'MENTIONED_IN_REEL',
      refs: { reel: newReel._id, reelId: newReel._id.toString() },
    });
  }

  if (newReel.linkedRouteId) {
    try {
      const linkedRoute = await Route.findById(newReel.linkedRouteId).select('author title').lean();
      if (linkedRoute?.author && linkedRoute.author.toString() !== userId.toString()) {
        createNotification({
          recipient: linkedRoute.author,
          sender: userId,
          type: 'VIBECUT_ROUTE_LINKED',
          reel: newReel._id,
          reelId: newReel._id.toString(),
          route: linkedRoute._id,
          routeId: linkedRoute._id.toString(),
        }).catch((err) => console.warn('[Reel] Notification route linked error:', err.message));
      }
    } catch (err) {
      console.warn('[Reel] Route lookup error:', err.message);
    }
  }

  respond({
    status: 'success',
    data: newReel,
  },201);

    return response;
};

export const getReelById = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id } = input.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return throwError(new AppError('Geçersiz reel ID.', 400));
  }

  const reel = await Reel.findOne({
    _id: id,
    isApproved: true,
    isDeleted: { $ne: true },
  }).lean();

  if (!reel) {
    return throwError(new AppError('Reel bulunamadı.', 404));
  }

  const viewerId = input.user?.id ? input.user.id.toString() : '';
  const withFlags = await attachViewerFlags([reel], viewerId);

  respond({
    status: 'success',
    data: withFlags[0] || reel,
  },200);

    return response;
};

export const getReels = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const limit = parsePositiveInt(input.query.limit, DEFAULT_REEL_LIMIT, MAX_REEL_LIMIT);
  const cursor = parseCursor(input.query.cursor);
  const viewerId = input.user?.id ? input.user.id.toString() : '';

  const queryConditions = [{ isApproved: true }, { isDeleted: { $ne: true } }];

  if (viewerId) {
    queryConditions.push({
      $or: [{ isPublic: { $ne: false } }, { userId: viewerId }]
    });
  } else {
    queryConditions.push({ isPublic: { $ne: false } });
  }

  if (cursor) {
    queryConditions.push({
      $or: [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ]
    });
  }

  const query = queryConditions.length === 1
    ? queryConditions[0]
    : { $and: queryConditions };

  const reelsRaw = await Reel.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = reelsRaw.length > limit;
  const reels = hasMore ? reelsRaw.slice(0, limit) : reelsRaw;
  const nextCursor = hasMore ? encodeCursor(reels[reels.length - 1]) : null;
  const withFlags = await attachViewerFlags(reels, viewerId);

  respond({
    status: 'success',
    data: withFlags,
    pagination: {
      hasMore,
      nextCursor,
      limit,
    },
  },200);

    return response;
};

export const getUserReels = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { userId } = input.params;
  if (!userId) {
    return throwError(new AppError('Kullanıcı ID gerekli.', 400));
  }

  const limit = parsePositiveInt(input.query.limit, 20, 50);
  const cursor = parseCursor(input.query.cursor);
  const viewerId = input.user?.id ? input.user.id.toString() : '';
  const isOwner = Boolean(viewerId && viewerId === userId.toString());

  const queryConditions = [
    { userId: userId.toString() },
    { isDeleted: { $ne: true } },
  ];

  if (!isOwner) {
    queryConditions.push({ isApproved: true });
    queryConditions.push({ isPublic: { $ne: false } });
  }

  if (cursor) {
    queryConditions.push({
      $or: [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ],
    });
  }

  const query = queryConditions.length === 1
    ? queryConditions[0]
    : { $and: queryConditions };

  const reelsRaw = await Reel.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = reelsRaw.length > limit;
  const reels = hasMore ? reelsRaw.slice(0, limit) : reelsRaw;
  const nextCursor = hasMore ? encodeCursor(reels[reels.length - 1]) : null;
  const withFlags = await attachViewerFlags(reels, viewerId);

  respond({
    status: 'success',
    data: withFlags,
    pagination: {
      hasMore,
      nextCursor,
      limit,
    },
  },200);

    return response;
};

export const adminGetReels = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const reels = await Reel.find().sort({ createdAt: -1 }).lean();
  respond({
    status: 'success',
    data: reels,
  },200);

    return response;
};

export const updateReelStatus = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id } = input.params;
  const { isApproved, isFeatured } = input.body;

  const updateData = {};
  if (typeof isApproved !== 'undefined') updateData.isApproved = Boolean(isApproved);
  if (typeof isFeatured !== 'undefined') updateData.isFeatured = Boolean(isFeatured);

  const updatedReel = await Reel.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });

  if (!updatedReel) {
    return throwError(new AppError('Reel bulunamadı.', 404));
  }

  respond({
    status: 'success',
    data: updatedReel,
  },200);

    return response;
};

export const updateReel = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id } = input.params;
  const { caption, bikeModel, tags, location, allowComments, isPublic } = input.body;
  const userId = input.user.id;

  const reel = await Reel.findById(id);
  if (!reel) {
    return throwError(new AppError('Reel bulunamadı.', 404));
  }

  if (!userId || reel.userId.toString() !== userId.toString()) {
    return throwError(new AppError('Bu islem icin yetkiniz yok.', 403));
  }

  const previousTags = Array.isArray(reel.tags) ? reel.tags : [];
  const previousCaption = reel.caption || '';
  if (typeof caption === 'string') reel.caption = caption.trim();
  if (typeof bikeModel === 'string') reel.bikeModel = bikeModel.trim();
  if (typeof location === 'string') reel.location = location.trim();
  if (typeof allowComments !== 'undefined') reel.allowComments = Boolean(allowComments);
  if (typeof isPublic !== 'undefined') reel.isPublic = Boolean(isPublic);

  const parsedTags = parseJsonField(tags, 'tags');
  const normalizedTags = mergeNormalizedTags({
    text: reel.caption || '',
    tags: Array.isArray(parsedTags) ? parsedTags : [],
  });
  reel.tags = normalizedTags;

  await reel.save();
  await syncTagUsage({ previousTags, nextTags: normalizedTags });

  if (reel.isPublic !== false) {
    notifyTextMentions({
      text: reel.caption || '',
      previousText: previousCaption,
      actorId: userId,
      type: 'MENTIONED_IN_REEL',
      refs: { reel: reel._id, reelId: reel._id.toString() },
    });
  }

  respond({
    status: 'success',
    data: reel,
  },200);

    return response;
};

export const deleteReel = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id } = input.params;
  const userId = input.user.id;
  const isAdminRequest = input.user.isAdmin === true;

  const reel = await Reel.findById(id);
  if (!reel || reel.isDeleted) {
    return throwError(new AppError('Reel bulunamadı.', 404));
  }

  if (!isAdminRequest) {
    if (reel.userId.toString() !== userId.toString()) {
      return throwError(new AppError('Bu islem icin yetkiniz yok.', 403));
    }
  }

  reel.isDeleted = true;
  await reel.save();

  await Promise.all([
    cleanupUploadedFile(reel.videoUrl),
    cleanupUploadedFile(reel.thumbnailUrl),
  ]);

  await syncTagUsage({
    previousTags: reel.tags || [],
    nextTags: [],
  });

  await ReelComment.deleteMany({ reel: reel._id });

  respond({
    status: 'success',
    message: 'Reel silindi.',
  },200);

    return response;
};

export const interactReel = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id } = input.params;
  const { type, sessionId } = input.body || {};
  const userId = input.user?.id;

  if (!interactionTypes.has(type)) {
    return throwError(new AppError('Geçersiz etkileşim tipi.', 400));
  }

  const reel = await Reel.findById(id);
  if (!reel || reel.isDeleted) {
    return throwError(new AppError('Reel bulunamadı.', 404));
  }

  let isLiked = false;
  let isSaved = false;
  let reelDirty = false;

  if (type === 'view') {
    const viewerKey = getViewerKey({
      reelId: id,
      userId: userId?.toString(),
      sessionId: sessionId?.toString(),
      ip: input.ip,
    });
    if (await shouldCountView(viewerKey)) {
      reel.views += 1;
      reelDirty = true;
    }
  } else if (type === 'share') {
    if (!userId || !userId.toString().trim()) {
      return throwError(new AppError('Paylaşmak için giriş yapmalısınız.', 401));
    }
    reel.shareCount += 1;
    reelDirty = true;
  } else if (type === 'like') {
    if (!userId || !userId.toString().trim()) {
      return throwError(new AppError('Beğenmek için giriş yapmalısınız.', 401));
    }

    const likedBy = Array.isArray(reel.likedBy) ? reel.likedBy : [];
    const cleanUserId = userId.toString();
    const alreadyLiked = likedBy.map(String).includes(cleanUserId);

    if (alreadyLiked) {
      reel.likes = Math.max(0, reel.likes - 1);
      reel.likedBy = likedBy.filter((uid) => uid.toString() !== cleanUserId);
      isLiked = false;
    } else {
      reel.likes += 1;
      reel.likedBy = [...likedBy, cleanUserId];
      isLiked = true;
      if (reel.userId && reel.userId.toString() !== cleanUserId) {
        createNotification({
          recipient: reel.userId,
          sender: cleanUserId,
          type: 'VIBECUT_LIKE',
          reel: reel._id,
          reelId: reel._id.toString(),
        }).catch((err) => console.warn('[Reel] Notification like error:', err.message));
      }
    }
    reelDirty = true;
  } else if (type === 'save') {
    if (!userId || !userId.toString().trim()) {
      return throwError(new AppError('Kaydetmek icin giriş yapmalısınız.', 401));
    }

    const cleanUserId = userId.toString();
    const reelObjectId = reel._id;
    const user = await User.findById(cleanUserId).select('savedReels');
    if (!user) {
      return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const saved = Array.isArray(user.savedReels) ? user.savedReels : [];
    const alreadySaved = saved.some(
      (savedId) => savedId.toString() === reelObjectId.toString(),
    );

    if (alreadySaved) {
      await User.updateOne(
        { _id: cleanUserId },
        { $pull: { savedReels: reelObjectId } },
      );
      isSaved = false;
    } else {
      await User.updateOne(
        { _id: cleanUserId },
        { $addToSet: { savedReels: reelObjectId } },
      );
      isSaved = true;
    }
  }

  if (reelDirty) {
    await reel.save();
  }

  if (userId) {
    const cleanUserId = userId.toString();
    if (type !== 'like') {
      isLiked = Array.isArray(reel.likedBy)
        ? reel.likedBy.map(String).includes(cleanUserId)
        : false;
    }
    if (type !== 'save') {
      const user = await User.findById(cleanUserId).select('savedReels').lean();
      isSaved = (user?.savedReels || []).some(
        (savedId) => savedId.toString() === reel._id.toString(),
      );
    }
  }

  respond({
    status: 'success',
    data: {
      likes: reel.likes,
      views: reel.views,
      shareCount: reel.shareCount,
      isLiked,
      isSaved,
    },
  },200);

    return response;
};

export const getSavedReels = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const userId = input.user?.id;
  if (!userId) {
    return throwError(new AppError('Kaydedilenler icin giriş gerekli.', 401));
  }

  const page = parsePositiveInt(input.query.page, 1, 1000);
  const limit = parsePositiveInt(input.query.limit, 20, 50);
  const skip = (page - 1) * limit;

  const user = await User.findById(userId).select('savedReels').lean();
  // Newest saves last in $addToSet order → reverse for newest-first feed.
  const savedIds = [...(user?.savedReels || [])]
    .map((id) => id.toString())
    .reverse();

  if (savedIds.length === 0) {
    return respond({
      status: 'success',
      data: [],
      pagination: {
        hasMore: false,
        nextCursor: null,
        limit,
        page,
        total: 0,
      },
    },200);
  }

  const pageIds = savedIds.slice(skip, skip + limit);
  const objectIds = pageIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const reels = await Reel.find({
    _id: { $in: objectIds },
    isApproved: true,
    isDeleted: { $ne: true },
  }).lean();

  const byId = new Map(reels.map((reel) => [reel._id.toString(), reel]));
  const ordered = pageIds.map((id) => byId.get(id)).filter(Boolean);
  const withFlags = await attachViewerFlags(ordered, userId.toString());

  respond({
    status: 'success',
    data: withFlags,
    pagination: {
      hasMore: skip + pageIds.length < savedIds.length,
      nextCursor: null,
      limit,
      page,
      total: savedIds.length,
    },
  },200);

    return response;
};

export const getReelComments = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id } = input.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return throwError(new AppError('Geçersiz reel ID.', 400));
  }

  const limit = parsePositiveInt(
    input.query.limit,
    DEFAULT_COMMENT_LIMIT,
    MAX_COMMENT_LIMIT,
  );
  const cursor = parseCursor(input.query.cursor);

  const query = { reel: id };
  if (cursor) {
    query.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }

  const commentsRaw = await ReelComment.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('author', 'name avatar isVerified');

  const hasMore = commentsRaw.length > limit;
  const comments = hasMore ? commentsRaw.slice(0, limit) : commentsRaw;
  const nextCursor = hasMore ? encodeCursor(comments[comments.length - 1]) : null;

  respond({
    status: 'success',
    results: comments.length,
    data: { comments },
    pagination: {
      hasMore,
      nextCursor,
      limit,
    },
  },200);

    return response;
};

export const addReelComment = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id } = input.params;
  const { content } = input.body || {};
  const userId = input.user.id;

  const cleanContent = typeof content === 'string' ? content.trim() : '';
  if (!cleanContent) {
    return throwError(new AppError('Yorum bos olamaz.', 400));
  }
  if (cleanContent.length > 500) {
    return throwError(new AppError('Yorum en fazla 500 karakter olabilir.', 400));
  }

  const [reel, user] = await Promise.all([
    Reel.findById(id),
    User.findById(userId).lean(),
  ]);

  if (!reel) {
    return throwError(new AppError('Reel bulunamadı.', 404));
  }
  if (!user) {
    return throwError(new AppError('Kullanıcı bulunamadı.', 404));
  }

  if (reel.allowComments === false) {
    return throwError(new AppError('Bu video için yorumlar kapatılmıştır.', 403));
  }

  const newComment = await ReelComment.create({
    content: cleanContent,
    author: user._id,
    reel: reel._id,
  });

  const updatedReel = await Reel.findByIdAndUpdate(
    reel._id,
    { $inc: { commentCount: 1 } },
    { new: true },
  );

  await newComment.populate('author', 'name avatar isVerified');

  if (reel.userId && reel.userId.toString() !== userId.toString()) {
    createNotification({
      recipient: reel.userId,
      sender: userId,
      type: 'VIBECUT_COMMENT',
      reel: reel._id,
      reelId: reel._id.toString(),
      commentId: newComment._id?.toString(),
    }).catch((err) => console.warn('[Reel] Notification comment error:', err.message));
  }
  notifyTextMentions({
    text: cleanContent,
    actorId: userId,
    type: 'MENTIONED_IN_REEL_COMMENT',
    // Reel owner already receives VIBECUT_COMMENT for this comment.
    excludeUserIds: [reel.userId],
    refs: { reel: reel._id, reelId: reel._id.toString(), commentId: newComment._id?.toString() },
  });
  await syncTagUsage({
    previousTags: [],
    nextTags: mergeNormalizedTags({ text: cleanContent }),
  });

  respond({
    status: 'success',
    comment: newComment,
    commentCount: updatedReel?.commentCount ?? reel.commentCount + 1,
  },201);

    return response;
};

export const deleteReelComment = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const { id: reelId, commentId } = input.params;
  const userId = input.user?.id;

  if (!mongoose.Types.ObjectId.isValid(reelId) || !mongoose.Types.ObjectId.isValid(commentId)) {
    return throwError(new AppError('Geçersiz parametreler.', 400));
  }

  const [reel, comment] = await Promise.all([
    Reel.findById(reelId),
    ReelComment.findById(commentId),
  ]);

  if (!reel) {
    return throwError(new AppError('Reel bulunamadı.', 404));
  }
  if (!comment) {
    return throwError(new AppError('Yorum bulunamadı.', 404));
  }

  if (comment.reel.toString() !== reel._id.toString()) {
    return throwError(new AppError('Yorum bu videoya ait değil.', 400));
  }

  const isCommentAuthor = comment.author.toString() === userId.toString();
  const isReelOwner = reel.userId.toString() === userId.toString();
  const isAdmin = input.user.isAdmin === true || input.user.role === 'admin';

  if (!isCommentAuthor && !isReelOwner && !isAdmin) {
    return throwError(new AppError('Bu yorumu silme yetkiniz yok.', 403));
  }

  await ReelComment.findByIdAndDelete(commentId);

  const updatedReel = await Reel.findByIdAndUpdate(
    reel._id,
    [
      {
        $set: {
          commentCount: {
            $max: [0, { $subtract: ['$commentCount', 1] }],
          },
        },
      },
    ],
    { new: true },
  );

  respond({
    status: 'success',
    message: 'Yorum silindi.',
    commentCount: updatedReel?.commentCount ?? Math.max(0, reel.commentCount - 1),
  },200);

    return response;
};
