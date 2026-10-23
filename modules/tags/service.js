import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import Tag from "./model.js";
import AppError from "../../utils/appError.js";

import {
  escapeRegex,
  formatTagDisplayName,
  normalizeTagName,
} from "../../utils/tagUtils.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

const parseLimit = (rawLimit, fallback = DEFAULT_LIMIT) => {
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIMIT);
};

const userIdAsString = (input) => input.user?._id?.toString?.() || input.user?.id?.toString?.() || null;

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
export const getTrendingTags = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const limit = parseLimit(input.query.limit);
  const viewerId = userIdAsString(input);

  const tags = await Tag.find({ postCount: { $gt: 0 } })
    .sort({ followerCount: -1, postCount: -1, lastUsedAt: -1 })
    .limit(limit)
    .select('name displayName postCount followerCount followerIds lastUsedAt')
    .lean();

  respond(tags.map((tag) => mapTagForResponse(tag, viewerId)),200);

    return response;
};

// Search tags for autocomplete
export const searchTags = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const rawQuery = input.query.q?.toString() || '';
  const normalizedQuery = normalizeTagName(rawQuery);
  const limit = parseLimit(input.query.limit, 12);

  if (!normalizedQuery) {
    return respond([],200);
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

  respond(tags.map((tag) => mapTagForResponse(tag, userIdAsString(input))),200);

    return response;
};

// Get a single tag's details
export const getTagDetails = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const normalizedName = normalizeTagName(input.params.name);
  if (!normalizedName) {
    return throwError(new AppError('Geçersiz etiket adı.', 400));
  }

  const tag = await Tag.findOne({ name: normalizedName })
    .select('name displayName postCount followerCount followerIds lastUsedAt')
    .lean();

  if (!tag) {
    return throwError(new AppError('Etiket bulunamadı.', 404));
  }

  respond(mapTagForResponse(tag, userIdAsString(input)),200);

    return response;
};

// Follow a tag (requires auth)
export const followTag = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const normalizedName = normalizeTagName(input.params.name);
  if (!normalizedName) {
    return throwError(new AppError('Geçersiz etiket adı.', 400));
  }

  const viewerId = userIdAsString(input);
  if (!viewerId) {
    return throwError(new AppError('Bu işlem için giriş yapmanız gerekiyor.', 401));
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
      $addToSet: { followerIds: input.user._id || input.user.id },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  const followerCount = await syncFollowerCount(tag);

  respond({
    followerCount,
    isFollowing: true,
    name: tag.name,
  },200);

    return response;
};

// Unfollow a tag (requires auth)
export const unfollowTag = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  const normalizedName = normalizeTagName(input.params.name);
  if (!normalizedName) {
    return throwError(new AppError('Geçersiz etiket adı.', 400));
  }

  const viewerId = userIdAsString(input);
  if (!viewerId) {
    return throwError(new AppError('Bu işlem için giriş yapmanız gerekiyor.', 401));
  }

  const tag = await Tag.findOne({ name: normalizedName });
  if (!tag) {
    return throwError(new AppError('Etiket bulunamadı.', 404));
  }

  tag.followerIds = (tag.followerIds || []).filter(
    (id) => id.toString() !== viewerId,
  );
  const followerCount = await syncFollowerCount(tag);

  respond({
    followerCount,
    isFollowing: false,
    name: tag.name,
  },200);

    return response;
};
