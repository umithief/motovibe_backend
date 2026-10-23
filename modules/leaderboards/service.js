import cron from 'node-cron';
import redis from "../../config/redis.js";
import User from "../users/model.js";
import Pack from "../packs/model.js";
import Ride from "../rides/model.js";

const CATEGORY_CONFIG = {
    weekly_distance: {
        key: 'leaderboard:weekly_distance',
        type: 'user',
        unit: 'KM',
        title: 'Uzun Yol Haftanin Sampiyonu'
    },
    weekly_pack_distance: {
        key: 'leaderboard:weekly_pack_distance',
        type: 'pack',
        unit: 'KM',
        title: 'Klan Haftanin Sampiyonu'
    },
    max_lean_angle: {
        key: 'leaderboard:max_lean_angle',
        type: 'user',
        unit: 'DEG',
        title: 'Viraj Haftanin Sampiyonu'
    }
};

const CATEGORY_ALIASES = {
    distance: 'weekly_distance',
    uzun_yol: 'weekly_distance',
    pack_distance: 'weekly_pack_distance',
    packs: 'weekly_pack_distance',
    clans: 'weekly_pack_distance',
    lean: 'max_lean_angle',
    lean_angle: 'max_lean_angle',
    viraj: 'max_lean_angle'
};

const MAX_CITY_CANDIDATES = 500;

const resolveCategory = (rawCategory) => {
    const normalized = (rawCategory || '').trim().toLowerCase();
    const slug = CATEGORY_ALIASES[normalized] || normalized;
    const config = CATEGORY_CONFIG[slug];
    if (!config) {
        throw new Error('Invalid leaderboard category');
    }
    return { slug, config };
};

const parseZSetPairs = (rawPairs) => {
    const parsed = [];
    for (let i = 0; i < rawPairs.length; i += 2) {
        parsed.push({
            id: rawPairs[i],
            score: Number(rawPairs[i + 1])
        });
    }
    return parsed;
};

const normalizeCity = (value) => {
    if (!value) return '';
    return String(value).trim().toLowerCase();
};

const getRedisClient = () => redis?.raw || null;

export const addWeeklyDistance = async (userId, kmDelta) => {
    return addScore('weekly_distance', userId, kmDelta);
};

export const addWeeklyPackDistance = async (packId, kmDelta) => {
    return addScore('weekly_pack_distance', packId, kmDelta);
};

export const recordMaxLeanAngle = async (userId, angle) => {
    return setMaxScore('max_lean_angle', userId, angle);
};

export const addScore = async (category, memberId, delta) => {
    const { config } = resolveCategory(category);
    const client = getRedisClient();
    if (!client || client.status !== 'ready') return null;
    const safeDelta = Number(delta) || 0;
    if (!memberId || safeDelta === 0) return null;
    return client.zincrby(config.key, safeDelta, memberId);
};

export const setMaxScore = async (category, memberId, score) => {
    const { config } = resolveCategory(category);
    const client = getRedisClient();
    if (!client || client.status !== 'ready') return null;
    const safeScore = Number(score) || 0;
    if (!memberId) return null;

    try {
        return await client.zadd(config.key, 'GT', safeScore, memberId);
    } catch (err) {
        const current = await client.zscore(config.key, memberId);
        const currentScore = Number(current) || 0;
        if (safeScore > currentScore) {
            return client.zadd(config.key, safeScore, memberId);
        }
        return null;
    }
};

export const fetchLeaderboard = async ({
    category,
    filter = 'global',
    userId,
    city
}) => {
    const { slug, config } = resolveCategory(category);
    const client = getRedisClient();
    const redisReady = client && client.status === 'ready';

    let parsed = [];
    if (redisReady) {
        const limit = 50;
        const isCityFilter = filter === 'city' && config.type === 'user';
        const candidateLimit = isCityFilter ? MAX_CITY_CANDIDATES : limit;

        const rawPairs = await client.zrevrange(
            config.key,
            0,
            candidateLimit - 1,
            'WITHSCORES'
        );
        parsed = parseZSetPairs(rawPairs);
    }

    // Fallback to MongoDB if Redis is not ready or has no data
    if (parsed.length === 0) {
        return fetchLeaderboardFromMongo({ slug, config, filter, userId, city });
    }

    const limit = 50;
    const isCityFilter = filter === 'city' && config.type === 'user';

    let entries = [];
    let myRank = null;
    let gapToTop100 = null;

    if (config.type === 'user') {
        const ids = parsed.map(item => item.id);
        const users = await User.find({ _id: { $in: ids } })
            .select('_id name username avatar location')
            .lean();
        const userMap = new Map(
            users.map(u => [u._id.toString(), u])
        );

        entries = parsed
            .map((item, index) => {
                const user = userMap.get(item.id);
                if (!user) return null;
                return {
                    id: item.id,
                    type: 'user',
                    name: user.name || user.username || 'Rider',
                    username: user.username || '',
                    avatar: user.avatar || '',
                    city: user.location || '',
                    score: item.score,
                    rank: index + 1
                };
            })
            .filter(Boolean);

        if (isCityFilter) {
            let cityValue = normalizeCity(city);
            if (!cityValue && userId) {
                const me = await User.findById(userId)
                    .select('location')
                    .lean();
                cityValue = normalizeCity(me?.location);
            }
            if (cityValue) {
                entries = entries.filter(
                    entry => normalizeCity(entry.city) === cityValue
                );
            }
            entries = entries.slice(0, limit)
                .map((entry, index) => ({ ...entry, rank: index + 1 }));
        } else {
            entries = entries.slice(0, limit);
        }

        if (userId) {
            const rawRank = await client.zrevrank(config.key, userId);
            const rawScore = await client.zscore(config.key, userId);
            if (rawRank !== null && rawRank !== undefined) {
                const userScore = Number(rawScore) || 0;
                myRank = {
                    rank: rawRank + 1,
                    score: userScore,
                    gapToTop100: null
                };

                if (!isCityFilter) {
                    const top100 = await client.zrevrange(
                        config.key,
                        99,
                        99,
                        'WITHSCORES'
                    );
                    if (top100.length >= 2) {
                        const threshold = Number(top100[1]) || 0;
                        if (threshold > userScore) {
                            gapToTop100 = threshold - userScore;
                        }
                    }
                }
            }
        }
    } else {
        const ids = parsed.map(item => item.id);
        const packs = await Pack.find({ _id: { $in: ids } })
            .select('_id name tag emblem')
            .lean();
        const packMap = new Map(
            packs.map(p => [p._id.toString(), p])
        );
        entries = parsed
            .map((item, index) => {
                const pack = packMap.get(item.id);
                if (!pack) return null;
                return {
                    id: item.id,
                    type: 'pack',
                    name: pack.name || 'Klan',
                    tag: pack.tag || '',
                    avatar: pack.emblem || '',
                    score: item.score,
                    rank: index + 1
                };
            })
            .filter(Boolean)
            .slice(0, limit);
    }

    if (myRank && gapToTop100 !== null) {
        myRank.gapToTop100 = gapToTop100;
    }

    return {
        category: slug,
        filter,
        unit: config.unit,
        entries,
        myRank
    };
};

const getStartOfWeek = async () => {
    const client = getRedisClient();
    let resetAt = null;
    if (client && client.status === 'ready') {
        try {
            const resetAtStr = await client.get('leaderboard:reset_at');
            if (resetAtStr) {
                resetAt = new Date(resetAtStr);
            }
        } catch (_) {}
    }

    const now = new Date();
    const day = now.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + diff);
    startOfWeek.setHours(0, 0, 0, 0);

    if (resetAt && resetAt > startOfWeek) {
        return resetAt;
    }
    return startOfWeek;
};

const fetchLeaderboardFromMongo = async ({ slug, config, filter, userId, city }) => {
    const limit = 50;
    const startOfWeek = await getStartOfWeek();


    if (config.type === 'user') {
        let entries = [];
        let myRank = null;

        if (slug === 'weekly_distance') {
            const agg = await Ride.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startOfWeek },
                        'stats.totalDistance': { $gt: 0 }
                    }
                },
                {
                    $group: {
                        _id: { $ifNull: ['$user', '$userId'] },
                        totalScore: { $sum: '$stats.totalDistance' }
                    }
                },
                { $sort: { totalScore: -1 } },
                { $limit: limit }
            ]);

            if (agg.length > 0) {
                const userIds = agg.map(a => a._id);
                const users = await User.find({ _id: { $in: userIds } })
                    .select('_id name username avatar location')
                    .lean();
                const userMap = new Map(users.map(u => [u._id.toString(), u]));

                entries = agg.map((item, index) => {
                    const u = userMap.get(item._id.toString());
                    return {
                        id: item._id.toString(),
                        type: 'user',
                        name: u?.name || u?.username || 'Rider',
                        username: u?.username || '',
                        avatar: u?.avatar || '',
                        city: u?.location || '',
                        score: Math.round(item.totalScore * 10) / 10,
                        rank: index + 1
                    };
                }).filter(e => e.score > 0);
            }
        } else if (slug === 'max_lean_angle') {
            const agg = await Ride.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startOfWeek },
                        'stats.maxLeanAngle': { $gt: 0 }
                    }
                },
                {
                    $group: {
                        _id: { $ifNull: ['$user', '$userId'] },
                        maxScore: { $max: '$stats.maxLeanAngle' }
                    }
                },
                { $sort: { maxScore: -1 } },
                { $limit: limit }
            ]);

            if (agg.length > 0) {
                const userIds = agg.map(a => a._id);
                const users = await User.find({ _id: { $in: userIds } })
                    .select('_id name username avatar location')
                    .lean();
                const userMap = new Map(users.map(u => [u._id.toString(), u]));

                entries = agg.map((item, index) => {
                    const u = userMap.get(item._id.toString());
                    return {
                        id: item._id.toString(),
                        type: 'user',
                        name: u?.name || u?.username || 'Rider',
                        username: u?.username || '',
                        avatar: u?.avatar || '',
                        city: u?.location || '',
                        score: Math.round(item.maxScore * 10) / 10,
                        rank: index + 1
                    };
                }).filter(e => e.score > 0);
            }
        }

        // Apply city filter
        if (filter === 'city') {
            let cityValue = normalizeCity(city);
            if (!cityValue && userId) {
                const me = await User.findById(userId).select('location').lean();
                cityValue = normalizeCity(me?.location);
            }
            if (cityValue) {
                entries = entries.filter(
                    entry => normalizeCity(entry.city) === cityValue
                );
            }
            entries = entries.slice(0, limit).map((entry, index) => ({
                ...entry,
                rank: index + 1
            }));
        } else {
            entries = entries.slice(0, limit);
        }

        if (userId) {
            const userIndex = entries.findIndex(e => e.id === userId.toString());
            if (userIndex !== -1) {
                const userScore = entries[userIndex].score;
                myRank = {
                    rank: userIndex + 1,
                    score: userScore,
                    gapToTop100: null
                };
            }
        }

        return {
            category: slug,
            filter,
            unit: config.unit,
            entries,
            myRank
        };
    } else {
        // Pack leaderboard
        const packs = await Pack.find({})
            .select('_id name tag emblem members')
            .lean();

        let entries = [];
        if (packs.length > 0) {
            const agg = await Ride.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startOfWeek },
                        'stats.totalDistance': { $gt: 0 }
                    }
                },
                {
                    $group: {
                        _id: { $ifNull: ['$user', '$userId'] },
                        userKm: { $sum: '$stats.totalDistance' }
                    }
                }
            ]);

            const userKmMap = new Map(agg.map(a => [a._id.toString(), a.userKm]));

            const packEntries = packs.map(pack => {
                let packKm = 0;
                if (pack.members && Array.isArray(pack.members)) {
                    for (const m of pack.members) {
                        packKm += userKmMap.get(m.toString()) || 0;
                    }
                }
                return {
                    id: pack._id.toString(),
                    type: 'pack',
                    name: pack.name || 'Klan',
                    tag: pack.tag || '',
                    avatar: pack.emblem || '',
                    score: Math.round(packKm * 10) / 10
                };
            }).filter(p => p.score > 0);

            packEntries.sort((a, b) => b.score - a.score);
            entries = packEntries.slice(0, limit).map((entry, index) => ({
                ...entry,
                rank: index + 1
            }));
        }

        return {
            category: slug,
            filter,
            unit: config.unit,
            entries,
            myRank: null
        };
    }
};


const buildBadge = ({ category, title, rank, score, weekOf }) => ({
    key: `${category}:${weekOf}:#${rank}`,
    title,
    category,
    rank,
    score,
    weekOf,
    awardedAt: new Date()
});

const awardWeeklyTrophies = async (categoryKey) => {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') return;
    const { slug, config } = resolveCategory(categoryKey);
    if (config.type !== 'user') return;

    const rawPairs = await client.zrevrange(
        config.key,
        0,
        2,
        'WITHSCORES'
    );
    const parsed = parseZSetPairs(rawPairs);
    if (parsed.length === 0) return;

    const weekOf = new Date().toISOString().slice(0, 10);

    await Promise.all(parsed.map((entry, index) => {
        const badge = buildBadge({
            category: slug,
            title: config.title,
            rank: index + 1,
            score: entry.score,
            weekOf
        });

        return User.updateOne(
            { _id: entry.id },
            { $addToSet: { trophyBadges: badge } }
        );
    }));
};

export const resetWeeklyLeaderboards = async () => {
    const client = getRedisClient();
    const nowIso = new Date().toISOString();

    if (client && client.status === 'ready') {
        const keys = [
            'weekly_distance',
            'weekly_pack_distance',
            'max_lean_angle'
        ];

        for (const key of keys) {
            await awardWeeklyTrophies(key);
            const { config } = resolveCategory(key);
            await client.del(config.key);
        }
        await client.set('leaderboard:reset_at', nowIso);
    }
};


let cronJob;

export const initLeaderboardCron = () => {
    if (cronJob) { cronJob.start(); return cronJob; }

    cronJob = cron.schedule(
        '59 23 * * 0',
        async () => {
            try {
                await resetWeeklyLeaderboards();
            } catch (err) {
                console.error('[Leaderboard Cron] reset failed:', err.message);
            }
        },
        {
            timezone: process.env.TZ || 'Europe/Istanbul'
        }
    );
    return cronJob;
};
