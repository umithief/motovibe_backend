import { serviceResult } from '../../utils/serviceResult.js';
import { hasActiveApexAccess } from "../../utils/apexAccess.js";
import { escapeRegex } from "../../utils/tagUtils.js";
import User from "./model.js";

const LIMIT = 8;
const MAX_QUERY = 30;

const bikeLabel = (bike) => [bike?.brand, bike?.model].filter(Boolean).join(' ').trim() || null;

export const toMentionUser = (user, followingSet = new Set()) => {
    const garage = Array.isArray(user.garage) ? user.garage : [];
    const primary = garage.find((bike) => bike?.isPrimary) || garage[0];
    return {
        _id: user._id,
        username: user.username,
        fullName: user.name || '',
        avatar: user.avatar || '',
        isApexPro: hasActiveApexAccess(user),
        isVerified: Boolean(user.isVerified),
        activeBike: bikeLabel(primary) || user.bikeModel || null,
        bikes: garage.map(bikeLabel).filter(Boolean).slice(0, 6),
        isFollowing: followingSet.has(String(user._id))
    };
};

/**
 * GET /api/users/mention-search?q=kelime
 * `username` is stored lowercase with a unique index, so an anchored,
 * case-sensitive prefix regex on the lowered query is an index range scan.
 */
export const mentionSearch = async (input) => {
    const raw = String(input.query.q ?? '').replace(/^@/, '').trim();
    if (!raw || raw.length > MAX_QUERY) {
        return serviceResult({ status: 'success', data: { users: [] } }, 200);
    }

    const prefix = escapeRegex(raw.toLowerCase());
    const myId = String(input.user.id);
    const myBlocked = (input.user.blockedUsers || []).map(String);

    const [viewer, users] = await Promise.all([
        User.findById(myId).select('following').lean(),
        User.find({
            $or: [
                { username: { $regex: '^' + prefix } },
                { name: { $regex: '^' + escapeRegex(raw), $options: 'i' } }
            ],
            _id: { $nin: [myId, ...myBlocked] },
            blockedUsers: { $ne: input.user.id },
            isDeleted: { $ne: true }
        })
            .select('_id name username avatar isVerified isPro isPremium isAdmin proExpiryDate bikeModel garage.brand garage.model garage.isPrimary')
            .limit(LIMIT * 3)
            .lean()
    ]);

    const followingSet = new Set((viewer?.following || []).map(String));
    const lowered = raw.toLowerCase();
    const ranked = users
        .filter((user) => user.username)
        .map((user) => toMentionUser(user, followingSet))
        .sort((a, b) => {
            const exact = Number(b.username === lowered) - Number(a.username === lowered);
            if (exact) return exact;
            const follow = Number(b.isFollowing) - Number(a.isFollowing);
            if (follow) return follow;
            const handle = Number(b.username.startsWith(lowered)) - Number(a.username.startsWith(lowered));
            if (handle) return handle;
            return a.username.length - b.username.length;
        })
        .slice(0, LIMIT);

    return serviceResult(
        { status: 'success', data: { users: ranked } },
        200,
        { headers: { 'Cache-Control': 'private, max-age=15' } }
    );
};
