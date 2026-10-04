import Tag from '../models/Tag.js';
import AppError from '../utils/appError.js';
import catchAsync from '../utils/catchAsync.js';
import {
  escapeRegex,
  formatTagDisplayName,
  normalizeTagName,
} from '../utils/tagUtils.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

const parseLimit = (rawLimit, fallback = DEFAULT_LIMIT) => {
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIMIT);
};

const userIdAsString = (req) => req.user?._id?.toString?.() || req.user?.id?.toString?.() || null;

const mapTagForResponse = (tag, viewerId) => {
  const followerIds = Array.isArray(tag.followerIds) ? tag.followerIds.map((id) => id.toString()) : [];
  const followerCount = typeof tag.followerCount === 'number' ? tag.followerCount : followerIds.length;

  return {
    _id: tag._id,
    name: tag.name,
    displayName: tag.displayName || formatTagDisplayName(tag.name),
    postCount: typeof tag.postCount === 'number' ? tag.postCount : 0,
    followerCount,
    lastUsedAt: tag.lastUsedAt,
    isFollowing: viewerId ? followerIds.includes(viewerId) : false,
  };
};

const syncFollowerCount = async (tagDoc) => {
  const followerCount = Array.isArray(tagDoc.followerIds) ? tagDoc.followerIds.length : 0;
  if (tagDoc.followerCount !== followerCount) {
    tagDoc.followerCount = followerCount;
    await tagDoc.save();
  }
  return followerCount;
};

// Get trending tags
export const getTrendingTags = catchAsync(async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const viewerId = userIdAsString(req);

  const tags = await Tag.find({ postCount: { $gt: 0 } })
    .sort({ followerCount: -1, postCount: -1, lastUsedAt: -1 })
    .limit(limit)
    .select('name displayName postCount followerCount followerIds lastUsedAt')
    .lean();

  res.status(200).json(tags.map((tag) => mapTagForResponse(tag, viewerId)));
});

// Search tags for autocomplete
export const searchTags = catchAsync(async (req, res) => {
  const rawQuery = req.query.q?.toString() || '';
  const normalizedQuery = normalizeTagName(rawQuery);
  const limit = parseLimit(req.query.limit, 12);

  if (!normalizedQuery) {
    return res.status(200).json([]);
  }

  const safeQuery = escapeRegex(normalizedQuery);
  const startsWithRegex = new RegExp(`^${safeQuery}`, 'i');
  const displayStartsWithRegex = new RegExp(`^#?${safeQuery}`, 'i');

  const tags = await Tag.find({
    $or: [
      { name: { $regex: startsWithRegex } },
      { displayName: { $regex: displayStartsWithRegex } },
    ],
  })
    .sort({ followerCount: -1, postCount: -1, lastUsedAt: -1 })
    .limit(limit)
    .select('name displayName postCount followerCount followerIds lastUsedAt')
    .lean();

  res.status(200).json(tags.map((tag) => mapTagForResponse(tag, userIdAsString(req))));
});

// Get a single tag's details
export const getTagDetails = catchAsync(async (req, res, next) => {
  const normalizedName = normalizeTagName(req.params.name);
  if (!normalizedName) {
    return next(new AppError('Geçersiz etiket adı.', 400));
  }

  const tag = await Tag.findOne({ name: normalizedName })
    .select('name displayName postCount followerCount followerIds lastUsedAt')
    .lean();

  if (!tag) {
    return next(new AppError('Etiket bulunamadı.', 404));
  }

  res.status(200).json(mapTagForResponse(tag, userIdAsString(req)));
});

// Follow a tag (requires auth)
export const followTag = catchAsync(async (req, res, next) => {
  const normalizedName = normalizeTagName(req.params.name);
  if (!normalizedName) {
    return next(new AppError('Geçersiz etiket adı.', 400));
  }

  const viewerId = userIdAsString(req);
  if (!viewerId) {
    return next(new AppError('Bu işlem için giriş yapmanız gerekiyor.', 401));
  }

  const tag = await Tag.findOneAndUpdate(
    { name: normalizedName },
    {
      $setOnInsert: {
        name: normalizedName,
        displayName: formatTagDisplayName(normalizedName),
        postCount: 0,
        followerCount: 0,
        lastUsedAt: new Date(),
      },
      $addToSet: { followerIds: req.user._id || req.user.id },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  const followerCount = await syncFollowerCount(tag);

  res.status(200).json({
    followerCount,
    isFollowing: true,
    name: tag.name,
  });
});

// Unfollow a tag (requires auth)
export const unfollowTag = catchAsync(async (req, res, next) => {
  const normalizedName = normalizeTagName(req.params.name);
  if (!normalizedName) {
    return next(new AppError('Geçersiz etiket adı.', 400));
  }

  const viewerId = userIdAsString(req);
  if (!viewerId) {
    return next(new AppError('Bu işlem için giriş yapmanız gerekiyor.', 401));
  }

  const tag = await Tag.findOne({ name: normalizedName });
  if (!tag) {
    return next(new AppError('Etiket bulunamadı.', 404));
  }

  tag.followerIds = (tag.followerIds || []).filter(
    (id) => id.toString() !== viewerId,
  );
  const followerCount = await syncFollowerCount(tag);

  res.status(200).json({
    followerCount,
    isFollowing: false,
    name: tag.name,
  });
});
