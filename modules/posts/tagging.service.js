// Cyber-Lens tagging & @mention domain logic.
import mongoose from 'mongoose';
import { serviceResult, throwError } from '../../utils/serviceResult.js';
import AppError from "../../utils/appError.js";
import { hasActiveApexAccess } from "../../utils/apexAccess.js";
import Post, { MAX_MEDIA_TAGS } from "./model.js";
import User from "../users/model.js";
import { createNotification } from "../notifications/service.js";

const MENTION_PATTERN = '@([a-zA-Z0-9_.]+)';
const MAX_MENTIONS = 30;
const { isValidObjectId } = mongoose;

/**
 * Returns unique lower-cased handles from `text`.
 * Skips e-mail addresses (`ali@motonom.com`) and trailing sentence dots (`@ali.`).
 */
export const parseMentionHandles = (text) => {
    if (!text || typeof text !== 'string') return [];
    const handles = new Set();
    // Fresh RegExp per call: a shared /g regex keeps `lastIndex` between calls.
    const regex = new RegExp(MENTION_PATTERN, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
        const previous = match.index > 0 ? text[match.index - 1] : '';
        if (/[a-zA-Z0-9_]/.test(previous)) continue;
        const handle = match[1].replace(/\.+$/, '').toLowerCase();
        if (handle.length >= 2) handles.add(handle);
        if (handles.size >= MAX_MENTIONS) break;
    }
    return [...handles];
};

/** Resolves @handles in `text` to existing user ids (author excluded). */
export const extractMentions = async (text, { excludeUserId } = {}) => {
    const handles = parseMentionHandles(text);
    if (handles.length === 0) return [];
    // `username` is stored lowercase and uniquely indexed.
    const users = await User.find({ username: { $in: handles }, isDeleted: { $ne: true } })
        .select('_id')
        .lean();
    return users
        .map((user) => user._id)
        .filter((id) => !excludeUserId || String(id) !== String(excludeUserId));
};

const clampPercent = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : null;
};

const parseTagInput = (raw) => {
    if (typeof raw === 'string') {
        // Multipart uploads send nested arrays as JSON strings.
        try { return JSON.parse(raw); } catch { return []; }
    }
    return raw;
};

/**
 * Validates client tags and snapshots the tagged user's public identity.
 * Drops invalid ids, deleted users, users in a block relationship with the
 * author, and duplicates on the same media slide.
 */
export const sanitizeMediaTags = async (rawTags, { author, mediaCount = 1 }) => {
    const list = parseTagInput(rawTags);
    if (!Array.isArray(list) || list.length === 0) return [];

    const lastIndex = Math.max(mediaCount, 1) - 1;
    const candidates = list.slice(0, MAX_MEDIA_TAGS).map((tag) => ({
        taggedUser: String(tag?.taggedUser?._id ?? tag?.taggedUser ?? tag?.userId ?? ''),
        taggedBike: typeof tag?.taggedBike === 'string' && tag.taggedBike.trim()
            ? tag.taggedBike.trim().slice(0, 80)
            : undefined,
        x: clampPercent(tag?.x),
        y: clampPercent(tag?.y),
        mediaIndex: Math.min(Math.max(parseInt(tag?.mediaIndex ?? 0, 10) || 0, 0), lastIndex),
        isApproved: tag?.isApproved !== false
    })).filter((tag) => isValidObjectId(tag.taggedUser) && tag.x !== null && tag.y !== null);

    if (candidates.length === 0) return [];

    const authorId = String(author._id || author.id);
    const authorBlocked = new Set((author.blockedUsers || []).map(String));
    const users = await User.find({
        _id: { $in: [...new Set(candidates.map((tag) => tag.taggedUser))] },
        isDeleted: { $ne: true }
    })
        .select('_id name username avatar isPro isPremium isAdmin proExpiryDate blockedUsers')
        .lean();

    const byId = new Map(users
        .filter((user) => !authorBlocked.has(String(user._id))
            && !(user.blockedUsers || []).some((id) => String(id) === authorId))
        .map((user) => [String(user._id), user]));

    const seen = new Set();
    return candidates.flatMap((tag) => {
        const user = byId.get(tag.taggedUser);
        const key = `${tag.mediaIndex}:${tag.taggedUser}`;
        if (!user || seen.has(key)) return [];
        seen.add(key);
        return [{
            ...tag,
            username: user.username,
            name: user.name,
            avatar: user.avatar,
            isApexPro: hasActiveApexAccess(user)
        }];
    });
};

/**
 * Fan-out for tags and mentions. A user who is both tagged and mentioned gets
 * one TAGGED_IN_POST notification. Failures never break the parent request.
 */
export const notifyTagsAndMentions = async ({ actorId, postId, commentId, taggedIds = [], mentionIds = [], mentionType = 'MENTIONED_IN_POST' }) => {
    const actor = String(actorId);
    const tagged = new Set(taggedIds.map(String));
    const jobs = [
        ...[...tagged].map((recipient) => ({ recipient, type: 'TAGGED_IN_POST' })),
        ...[...new Set(mentionIds.map(String))]
            .filter((recipient) => !tagged.has(recipient))
            .map((recipient) => ({ recipient, type: mentionType }))
    ].filter((job) => job.recipient !== actor);

    await Promise.allSettled(jobs.map((job) => createNotification({
        recipient: job.recipient,
        sender: actorId,
        type: job.type,
        post: postId,
        commentId
    })));
};

const loadOwnedPost = async (input) => {
    if (!isValidObjectId(input.params.id)) return throwError(new AppError('Post bulunamadı.', 404));
    const post = await Post.findById(input.params.id);
    if (!post || post.isDeleted) return throwError(new AppError('Post bulunamadı.', 404));
    return post;
};

// PATCH /api/posts/:id/tags — author replaces the full tag set.
export const updatePostTags = async (input) => {
    const post = await loadOwnedPost(input);
    if (String(post.user) !== String(input.user.id)) {
        return throwError(new AppError('Bu gönderinin etiketlerini düzenleme yetkin yok.', 403));
    }

    const previous = new Set(post.mediaTags.map((tag) => String(tag.taggedUser)));
    const nextTags = await sanitizeMediaTags(input.body?.mediaTags, {
        author: input.user,
        mediaCount: (post.media || []).length
    });

    post.mediaTags = nextTags;
    await post.save();

    notifyTagsAndMentions({
        actorId: input.user.id,
        postId: post._id,
        taggedIds: nextTags.map((tag) => tag.taggedUser).filter((id) => !previous.has(id))
    }).catch(() => {});

    return serviceResult({
        status: 'success',
        message: 'Etiketler güncellendi.',
        data: { mediaTags: post.mediaTags }
    }, 200);
};

/**
 * PATCH /api/posts/:id/tags/remove-me   body: { mode: 'remove' | 'hide' }
 * remove → tag (and mention) is pulled from the post.
 * hide   → tag stays on the media but leaves the user's "Etiketlenenler" tab.
 * Only ever touches the caller's own tag, atomically.
 */
export const removeMyTag = async (input) => {
    if (!isValidObjectId(input.params.id)) return throwError(new AppError('Post bulunamadı.', 404));
    const me = new mongoose.Types.ObjectId(String(input.user.id));
    const mode = input.body?.mode === 'hide' ? 'hide' : 'remove';

    const result = mode === 'remove'
        ? await Post.updateOne(
            { _id: input.params.id, 'mediaTags.taggedUser': me },
            { $pull: { mediaTags: { taggedUser: me }, mentions: me } }
        )
        : await Post.updateOne(
            { _id: input.params.id, 'mediaTags.taggedUser': me },
            { $set: { 'mediaTags.$[mine].isApproved': false } },
            { arrayFilters: [{ 'mine.taggedUser': me }] }
        );

    if (result.matchedCount === 0) {
        return throwError(new AppError('Bu gönderide etiketin bulunmuyor.', 404));
    }

    return serviceResult({
        status: 'success',
        message: mode === 'remove' ? 'Etiketin gönderiden kaldırıldı.' : 'Gönderi profilinden gizlendi.',
        data: { postId: input.params.id, mode }
    }, 200);
};
