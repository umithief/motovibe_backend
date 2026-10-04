import Tag from '../models/Tag.js';
import { formatTagDisplayName, mergeTagSources, sanitizeTagList } from './tagUtils.js';

/**
 * Merge and normalize tags coming from text and explicit lists.
 * We keep this exported so controllers can store the exact same format.
 */
export const mergeNormalizedTags = ({ text = '', tags = [] } = {}) =>
  mergeTagSources({ text, tags });

const toUniqueList = (tags) => sanitizeTagList(tags);

const buildIncrementOps = (tagNames, amount, now) =>
  tagNames.map((name) => ({
    updateOne: {
      filter: { name },
      update: {
        ...(amount > 0
          ? {
              $setOnInsert: {
                name,
                displayName: formatTagDisplayName(name),
                postCount: 0,
                followerCount: 0,
                followerIds: [],
              },
            }
          : {}),
        $inc: { postCount: amount },
        $set: { lastUsedAt: now },
      },
      upsert: amount > 0,
    },
  }));

/**
 * Sync tag counters based on previous and next tag sets.
 * This keeps tag stats stable during create/update/delete actions.
 */
export const syncTagUsage = async ({ previousTags = [], nextTags = [] } = {}) => {
  const previous = toUniqueList(previousTags);
  const next = toUniqueList(nextTags);

  const previousSet = new Set(previous);
  const nextSet = new Set(next);

  const addedTags = next.filter((tag) => !previousSet.has(tag));
  const removedTags = previous.filter((tag) => !nextSet.has(tag));

  if (addedTags.length === 0 && removedTags.length === 0) {
    return { addedTags: [], removedTags: [], finalTags: next };
  }

  const now = new Date();
  const bulkOps = [
    ...buildIncrementOps(addedTags, 1, now),
    ...buildIncrementOps(removedTags, -1, now),
  ];

  try {
    await Tag.bulkWrite(bulkOps);
    if (removedTags.length > 0) {
      await Tag.updateMany(
        { name: { $in: removedTags }, postCount: { $lt: 0 } },
        { $set: { postCount: 0 } },
      );
    }
    return { addedTags, removedTags, finalTags: next };
  } catch (error) {
    console.error('[TagSync] Tags update error:', error);
    return { addedTags: [], removedTags: [], finalTags: next };
  }
};

/**
 * Backward-compatible helper used in existing controllers.
 * It extracts tags from text and increments counters.
 */
export const extractAndUpdateTags = async (text) => {
  const nextTags = mergeTagSources({ text });
  await syncTagUsage({ previousTags: [], nextTags });
  return nextTags;
};
