// Shared @mention fan-out for every user-written surface (posts, VibeCut,
// packs, routes, stories, events). Each surface passes its own notification
// type and content refs so the app can open the right screen on tap.
import { extractMentions } from "../posts/tagging.service.js";
import { createNotification } from "./service.js";

export const MENTION_TYPES = Object.freeze([
    'MENTIONED_IN_REEL',
    'MENTIONED_IN_REEL_COMMENT',
    'MENTIONED_IN_ROUTE_REVIEW',
    'MENTIONED_IN_PACK',
    'MENTIONED_IN_STORY',
    'MENTIONED_IN_EVENT'
]);

/**
 * @param {object} options
 * @param {string} options.text            User-written text to scan.
 * @param {string} options.actorId         Author; never notified.
 * @param {string} options.type            One of MENTION_TYPES (or post types).
 * @param {object} [options.refs]          createNotification refs (reel, route, pack, relatedId, commentId...).
 * @param {string} [options.previousText]  On edits: only newly added mentions notify.
 * @param {Array}  [options.excludeUserIds] Already notified for this action (e.g. content owner).
 * @param {Array}  [options.allowedUserIds] When set, only these users may be notified (e.g. pack members).
 * @returns {Promise<import('mongoose').Types.ObjectId[]>} all resolved mention ids.
 */
export const notifyTextMentions = async ({ text, actorId, type, refs = {}, previousText, excludeUserIds = [], allowedUserIds }) => {
    try {
        const mentions = await extractMentions(text, { excludeUserId: actorId });
        if (mentions.length === 0) return mentions;

        const skip = new Set(excludeUserIds.filter(Boolean).map(String));
        if (previousText) {
            for (const id of await extractMentions(previousText, { excludeUserId: actorId })) skip.add(String(id));
        }

        const allowed = allowedUserIds ? new Set(allowedUserIds.filter(Boolean).map(String)) : null;
        await Promise.allSettled(mentions
            .filter((id) => !skip.has(String(id)) && (!allowed || allowed.has(String(id))))
            .map((recipient) => createNotification({ recipient, sender: actorId, type, ...refs })));
        return mentions;
    } catch (error) {
        console.warn(`[Mentions] ${type} fan-out failed:`, error.message);
        return [];
    }
};
