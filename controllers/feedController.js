
import Post from '../models/Post.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Reel from '../models/Reel.js';
import Route from '../models/Route.js';
import VibeConfig from '../models/VibeConfig.js';
import mongoose from 'mongoose';
import redis from '../config/redis.js';
import { discoveryWindow, trimDiscoverySources } from '../services/discoveryPaging.js';
import { getRuntimeCapabilities } from '../config/release.js';

const normalizeSignal = (value) => String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR');

const signalsMatch = (left, right) => {
    if (left === right) return true;
    if ((left.length >= 3 && right.includes(left)) ||
        (right.length >= 3 && left.includes(right))) {
        return true;
    }
    const leftTokens = left.split(/[\s/,_-]+/u).filter(token => token.length >= 2);
    const rightTokens = new Set(
        right.split(/[\s/,_-]+/u).filter(token => token.length >= 2)
    );
    return leftTokens.some(token => rightTokens.has(token));
};

const stableHash = (value) => {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

export const stableJitter = (value) =>
    0.8 + (stableHash(value) / 0xffffffff) * 0.4;

export const buildViewerContext = (currentUser) => ({
    activeBikeModel: currentUser?.primaryBike || currentUser?.bikeModel || null,
    interests: (currentUser?.interestVector || [])
        .map(normalizeSignal)
        .filter(Boolean)
});

export const canonicalizeCategory = (rawCategory) => {
    const norm = normalizeSignal(rawCategory);
    if (!norm || ['for_you', 'foryou', 'sizin için', 'sizin_icin', 'all', 'genel'].includes(norm)) {
        return 'for_you';
    }
    if (['trend', 'trending'].includes(norm)) return 'trend';
    if (['videolar', 'video', 'vlog', 'reels', 'reel', 'videos'].includes(norm)) return 'videos';
    if (['rotalar', 'rota', 'routes', 'route'].includes(norm)) return 'routes';
    if (['takip edilenler', 'takip', 'following', 'followed', 'takip_edilenler'].includes(norm)) return 'following';
    return norm;
};

export const buildDiscoveryCacheKey = (
    userId,
    { blockedUsers = [], viewerContext = {}, category = '' } = {}
) => {
    const canonicalCat = canonicalizeCategory(category);
    const normCategory = canonicalCat === 'for_you' ? '' : canonicalCat;
    if (!userId && !normCategory) return 'feed:discover:global';

    const interests = (viewerContext.interests || [])
        .map(normalizeSignal)
        .filter(Boolean)
        .sort();
    const blocked = blockedUsers.map(id => String(id)).sort();
    const contextSignals = [
        normalizeSignal(viewerContext.activeBikeModel),
        ...interests,
        ...blocked,
        normCategory
    ].filter(Boolean);
    const fingerprint = stableHash(contextSignals.join('|')).toString(16);
    return `feed:discover:${userId || 'anon'}:${normCategory ? `${normCategory}:` : ''}${fingerprint}`;
};

export const rankDiscoveryItems = (items, rankingSeed = 'global') =>
    [...items].sort((a, b) => {
        const scoreA = a.score * stableJitter(`${rankingSeed}:${a.id}`);
        const scoreB = b.score * stableJitter(`${rankingSeed}:${b.id}`);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return String(a.id).localeCompare(String(b.id));
    });

// --- Helper: Get Config (Cached) ---
export const getConfig = async () => {
    try {
        // Try Redis first
        const cacheKey = 'vibe:config';
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    } catch (err) {
        // Redis failure shouldn't stop flow
    }

    // Fetch or Create DB
    let config = await VibeConfig.findById('default_config');
    if (!config) {
        config = await VibeConfig.create({ _id: 'default_config' });
    }

    // Cache for 1 hour
    try {
        await redis.set('vibe:config', JSON.stringify(config), 'EX', 3600);
    } catch (err) { }

    return config;
};

// --- Helper: Node.js VibeScore Calculator (For updates) ---
export const calculateVibeScore = (
    item,
    type = 'post',
    viewerContext = {},
    config = null,
    rankingSeed = 'global'
) => {
    // defaults mapped safely to prevent NaN issues on partial updates
    const w = {
        like: config?.weights?.like ?? 10,
        comment: config?.weights?.comment ?? 30,
        share: config?.weights?.share ?? 50,
        save: config?.weights?.save ?? 60
    };
    
    const m = {
        telemetry: config?.multipliers?.telemetry ?? 1.5,
        affinity: config?.affinity ?? 1.3, // fallback if multipliers.affinity is missing
        pro: config?.multipliers?.pro ?? 1.2
    };
    if (config?.multipliers?.affinity !== undefined) m.affinity = config.multipliers.affinity;
    
    const decay = {
        enabled: config?.timeDecay?.enabled ?? true,
        factor: config?.timeDecay?.factor ?? 1.8,
        maxAgeDays: config?.timeDecay?.maxAgeDays ?? 30
    };

    let score = 0;

    // 1. Engagement Score based on Type
    if (type === 'post') {
        const likes = item.likeCount || (item.likes ? item.likes.length : 0);
        const comments = item.commentCount || (item.comments ? item.comments.length : 0);
        const shares = item.shareCount || 0;
        const saves = item.saveCount || (item.saves ? item.saves.length : 0);
        score = (likes * w.like) + (comments * w.comment) + (shares * w.share) + (saves * w.save);
    } else if (type === 'reel') {
        const likes = item.likes || 0;
        const comments = item.commentCount || item.comments || 0;
        const shares = item.shareCount || 0;
        const saves = item.saves || 0;
        const views = item.views || 0;
        
        // Exact same logic with added views bonus
        score = (likes * w.like) + (comments * w.comment) + (shares * w.share) + (saves * w.save) + (views / 5);
    } else if (type === 'route') {
        const riders = item.riderCount || 0;
        const rating = item.rating || 0;
        const reviews = (item.reviews || []).length;
        score = (riders * 2) + (rating * 15) + (reviews * w.comment);
    }


    // Give base score if none found to ensure new items have a chance
    if (score === 0) {
        const itemId = item?._id || item?.id || item?.createdAt || 'new-item';
        score = 5 + ((stableJitter(`${rankingSeed}:${type}:${itemId}`) - 0.8) / 0.4) * 5;
    }

    // 2. Uniform Multipliers for both
    
    // Telemetry & Route Scoring Parameters
    const tc = config?.telemetryConfig || {};
    const leanAngleMultiplier = tc.leanAngleMultiplier ?? 1.4;
    const speedQualityBonus = tc.speedQualityBonus ?? 1.3;
    const minLeanAngleThreshold = tc.minLeanAngleThreshold ?? 35;
    const elevationDifficultyWeight = tc.elevationDifficultyWeight ?? 1.25;
    const verifiedRouteBoost = tc.verifiedRouteBoost ?? 1.5;
    const gpxExportWeight = tc.gpxExportWeight ?? 40;

    // Telemetry
    if (item.telemetryQuality || (item.telemetry && (item.telemetry.speed > 0 || item.telemetry.maxSpeed > 0))) {
        score *= m.telemetry;

        const lean = item.telemetry?.leanAngle || item.telemetry?.maxLeanAngle || item.maxLeanAngle || 0;
        if (lean >= minLeanAngleThreshold) {
            score *= leanAngleMultiplier;
        }
        if (item.telemetry?.isVerified || item.telemetry?.speedQuality === 'HIGH') {
            score *= speedQualityBonus;
        }
    }

    // Route specific scoring
    if (type === 'route' || item.isRoute || item.geometry || (item.waypoints && item.waypoints.length > 0)) {
        if (item.downloadsCount || item.ridesCount) {
            score += ((item.downloadsCount || 0) + (item.ridesCount || 0)) * gpxExportWeight;
        }
        if (item.isVerified || item.isApexRoute) {
            score *= verifiedRouteBoost;
        }
        if ((item.elevationGain && item.elevationGain > 300) || item.difficulty === 'ADVANCED' || item.difficulty === 'EXPERT') {
            score *= elevationDifficultyWeight;
        }
    }
    
    // Garage / interest match (one affinity boost at most).
    const viewerSignals = [
        viewerContext.activeBikeModel,
        ...(viewerContext.interests || [])
    ].map(normalizeSignal).filter(Boolean);
    const itemSignals = [item.bikeModel, ...(item.tags || [])]
        .map(normalizeSignal)
        .filter(Boolean);
    const hasAffinity = viewerSignals.some(viewerSignal =>
        itemSignals.some(itemSignal => signalsMatch(viewerSignal, itemSignal))
    );
    if (hasAffinity) {
        score *= m.affinity;
    }
    
    // Verified Pro (Checking both Post and Reel schema user contexts)
    const rank = item.userRank || (item.userId && item.userId.rank ? item.userId.rank : null);
    const verified = (item.userId && item.userId.isVerified);
    if (rank === 'Pro Rider' || rank === 'MotoVibe Pro' || verified) {
        score *= m.pro;
    }

    // 3. Time Decay (Applies to all)
    if (decay.enabled && item.createdAt) {
        const hoursSincePosted = (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSincePosted > 0) {
            const decayFactor = Math.pow(hoursSincePosted + 2, decay.factor);
            return score / decayFactor;
        }
    }

    return score;
};

// --- Global Product Cache for Sponsored Content ---
let cachedSponsoredProducts = null;
let lastProductFetch = 0;
const PROD_CACHE_TTL = 15 * 60 * 1000; // 15 mins

const getViewerFeedContext = async (userId) => {
    if (!userId) {
        return { blockedUsers: [], savedPostIds: [], savedReelIds: [], viewerContext: {}, followingIds: [] };
    }

    const currentUser = await User.findById(userId)
        .select('blockedUsers savedPosts savedReels primaryBike bikeModel interestVector following')
        .lean();

    return {
        blockedUsers: (currentUser?.blockedUsers || []).map(id => id.toString()),
        savedPostIds: (currentUser?.savedPosts || []).map(id => id.toString()),
        savedReelIds: (currentUser?.savedReels || []).map(id => id.toString()),
        followingIds: (currentUser?.following || []).map(id => id.toString()),
        viewerContext: buildViewerContext(currentUser)
    };
};

const hydrateReelUsers = async (reels) => {
    if (!reels || reels.length === 0) return reels;
    const userIds = [
        ...new Set(
            reels.map(r => {
                const uid = r.userId && typeof r.userId === 'object'
                    ? (r.userId._id?.toString() || r.userId.id?.toString())
                    : r.userId?.toString();
                return uid;
            }).filter(id => id && mongoose.Types.ObjectId.isValid(id))
        )
    ];

    if (userIds.length === 0) return reels;

    const users = await User.find({ _id: { $in: userIds } })
        .select('name username avatar isVerified')
        .lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    return reels.map(r => {
        const plain = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
        const uid = plain.userId && typeof plain.userId === 'object'
            ? (plain.userId._id?.toString() || plain.userId.id?.toString())
            : plain.userId?.toString();
        const user = userMap.get(uid);
        if (user) {
            return {
                ...plain,
                userId: user,
                userName: user.name || plain.userName,
                userAvatar: user.avatar || plain.userAvatar
            };
        }
        return plain;
    });
};

export const enrichFeedItem = (item, type, userId, savedPostIds = [], savedReelIds = []) => {
    const plain = typeof item?.toObject === 'function' ? item.toObject() : item;
    if (!plain) return null;

    if (type === 'reel') {
        const { likedBy, ...rest } = plain;
        let userObj = {};
        if (plain.userId && typeof plain.userId === 'object') {
            userObj = {
                _id: plain.userId._id?.toString() || plain.userId.id?.toString(),
                name: plain.userId.name || plain.userName || 'Sürücü',
                username: plain.userId.username || plain.userName || 'surucu',
                avatar: plain.userId.avatar || plain.userAvatar || '',
                isVerified: Boolean(plain.userId.isVerified)
            };
        } else {
            userObj = {
                _id: plain.userId?.toString(),
                name: plain.userName || 'Sürücü',
                username: plain.userName || 'surucu',
                avatar: plain.userAvatar || '',
                isVerified: false
            };
        }

        return {
            ...rest,
            _id: `re:${plain._id}`,
            id: `re:${plain._id}`,
            user: userObj,
            userName: userObj.name,
            userAvatar: userObj.avatar,
            type: 'reel',
            isLiked: Boolean(userId) && (likedBy || [])
                .some(id => id.toString() === userId),
            isSaved: Boolean(userId) && (savedReelIds || []).includes(plain._id.toString())
        };
    }

    if (type === 'route' || plain.type === 'route') {
        const authorObj = plain.author && typeof plain.author === 'object' ? {
            _id: plain.author._id?.toString() || plain.author.id?.toString(),
            name: plain.author.name || plain.author.username || 'Motonom Rotalar',
            username: plain.author.username || 'motonom_routes',
            avatar: plain.author.avatar || '',
            rank: plain.author.rank || 'Rota Rehberi',
            isVerified: true
        } : {
            _id: plain.author?.toString() || 'motonom_routes',
            name: 'Motonom Rotalar',
            username: 'motonom_routes',
            avatar: 'https://motonom.vercel.app/logo-square.png',
            rank: 'Rota Rehberi',
            isVerified: true
        };

        const image = plain.image || (plain.photos && plain.photos.length > 0 ? plain.photos[0] : null);
        const images = (plain.photos && plain.photos.length > 0) ? plain.photos : (image ? [image] : []);
        const distanceStr = plain.distance || (plain.distanceMeters ? `${(plain.distanceMeters / 1000).toFixed(0)} km` : null);
        const routeIdStr = (plain.routeId || plain._id)?.toString()?.replace(/^ro:/, '');

        return {
            ...plain,
            _id: plain._id?.toString()?.startsWith('ro:') ? plain._id : `ro:${plain._id}`,
            id: plain._id?.toString()?.startsWith('ro:') ? plain._id : `ro:${plain._id}`,
            routeId: routeIdStr,
            type: 'route',
            content: plain.title || plain.content || plain.description || 'Rota',
            caption: plain.title || plain.caption || plain.description || 'Rota',
            description: plain.description || plain.title || '',
            image,
            images,
            distance: distanceStr,
            routeDistance: distanceStr,
            difficulty: plain.difficulty || 'Orta',
            routeDifficulty: plain.difficulty || 'Orta',
            user: authorObj,
            userName: authorObj.name,
            userAvatar: authorObj.avatar,
            userRank: authorObj.rank,
            isUserVerified: true,
            likeCount: plain.riderCount || plain.likeCount || (plain.rating ? Math.round(plain.rating * 10) : 0),
            commentCount: plain.commentCount || (plain.reviews ? plain.reviews.length : 0),
            isLiked: false,
            isSaved: Boolean(savedPostIds) && savedPostIds.includes(routeIdStr)
        };
    }

    const hasRoute = Boolean(plain.linkedRoute || plain.rideStats?.rideId);
    const resolvedType = plain.type && plain.type !== 'post'
        ? plain.type
        : (hasRoute ? 'route' : 'post');
    const routeId = plain.routeId || plain.linkedRoute?.toString() || plain.rideStats?.rideId?.toString();
    const routeDistance = plain.routeDistance ||
        (plain.rideStats?.distance ? `${plain.rideStats.distance} km` : (plain.telemetry?.distance ? `${plain.telemetry.distance} km` : null));

    return {
        ...plain,
        type: resolvedType,
        ...(routeId ? { routeId } : {}),
        ...(routeDistance ? { routeDistance } : {}),
        isLiked: Boolean(userId) && (plain.likes || [])
            .some(id => id.toString() === userId),
        isSaved: Boolean(savedPostIds) && savedPostIds.includes(plain._id.toString())
    };
};

// --- Controller: Get Personalized Feed ---
export const getDiscoveryFeed = async (req, res) => {
    try {
        const userId = req.user?._id?.toString();
        const page = req.query.page === undefined ? 1 : Number(req.query.page);
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
            return res.status(400).json({ status: 'error', message: 'Geçersiz sayfa.' });
        }
        const limit = 20;
        const rawCategory = req.query.category || '';
        const category = canonicalizeCategory(rawCategory);
        const { blockedUsers, savedPostIds, savedReelIds, viewerContext, followingIds = [] } =
            await getViewerFeedContext(userId);
        // Fetch a new, disjoint source window for every requested page.
        const config = await getConfig();
        const decay = config.timeDecay || {};

        const daysToLookBack = decay.maxAgeDays || 60;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToLookBack);

        let posts = [];
        let reels = [];
        let routes = [];

        const isVideoCategory = category === 'videos';
        const isRouteCategory = category === 'routes';
        const isTrendCategory = category === 'trend';
        const isFollowingCategory = category === 'following';
        const isForYouCategory = category === 'for_you';

        const window = discoveryWindow(category, page);
        const { postSize: postPageSize, reelSize: reelPageSize,
            postOffset, reelOffset, routeOffset } = window;

        if (isVideoCategory) {
            reels = await Reel.find({
                userId: { $nin: blockedUsers },
                isDeleted: { $ne: true },
                isApproved: true,
                isPublic: { $ne: false }
            })
                .sort({ views: -1, createdAt: -1, _id: -1 })
                .skip(reelOffset)
                .limit(reelPageSize + 1)
                .lean();
        } else if (isRouteCategory) {
            const [routeDocs, routePosts] = await Promise.all([
                Route.find({
                    isDeleted: { $ne: true }
                })
                    .sort({ riderCount: -1, rating: -1, createdAt: -1, _id: -1 })
                    .skip(routeOffset)
                    .limit(window.routeSize + 1)
                    .populate('author', 'name username avatar rank isVerified')
                    .lean(),
                Post.find({
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' },
                    $or: [
                        { linkedRoute: { $ne: null } },
                        { 'rideStats.rideId': { $ne: null } },
                        { 'rideStats.distance': { $gt: 0 } },
                        { tags: { $in: ['rota', 'route', 'rotalar', 'routes'] } }
                    ]
                })
                    .sort({ likeCount: -1, createdAt: -1, _id: -1 })
                    .skip(postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean()
            ]);
            routes = routeDocs || [];
            posts = routePosts || [];
        } else if (isFollowingCategory) {
            const validFollowedIds = followingIds.filter(id => !blockedUsers.includes(id));
            if (validFollowedIds.length > 0) {
                [posts, reels] = await Promise.all([
                    Post.find({
                        user: { $in: validFollowedIds },
                        isDeleted: { $ne: true },
                        type: { $ne: 'reel' }
                    })
                        .sort({ createdAt: -1, _id: -1 })
                        .skip(postOffset)
                        .limit(postPageSize + 1)
                        .populate('user', 'name username avatar rank')
                        .lean(),
                    Reel.find({
                        userId: { $in: validFollowedIds },
                        isDeleted: { $ne: true },
                        isApproved: true,
                        isPublic: { $ne: false }
                    })
                        .sort({ createdAt: -1, _id: -1 })
                        .skip(reelOffset)
                        .limit(reelPageSize + 1)
                        .lean()
                ]);
            } else {
                posts = [];
                reels = [];
            }
        } else if (isTrendCategory) {
            // Trend prioritizes high engagement velocity (likes, views, comments)
            [posts, reels] = await Promise.all([
                Post.find({
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' }
                })
                    .sort({ likeCount: -1, commentCount: -1, createdAt: -1, _id: -1 })
                    .skip(postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean(),
                Reel.find({
                    userId: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    isApproved: true,
                    isPublic: { $ne: false }
                })
                    .sort({ views: -1, likes: -1, createdAt: -1, _id: -1 })
                    .skip(reelOffset)
                    .limit(reelPageSize + 1)
                    .lean()
            ]);
        } else if (isForYouCategory) {
            // Sizin İçin balances recent community freshness with personalized ranking and route highlights
            const [recentPosts, recentReels, featuredRoutes] = await Promise.all([
                Post.find({
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' }
                })
                    .sort({ createdAt: -1, _id: -1 })
                    .skip(postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean(),
                Reel.find({
                    userId: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    isApproved: true,
                    isPublic: { $ne: false }
                })
                    .sort({ createdAt: -1, _id: -1 })
                    .skip(reelOffset)
                    .limit(reelPageSize + 1)
                    .lean(),
                page === 1 ? Route.find({ isDeleted: { $ne: true } })
                    .sort({ riderCount: -1, _id: -1 })
                    .limit(window.routeSize)
                    .populate('author', 'name username avatar rank isVerified')
                    .lean() : Promise.resolve([])
            ]);
            posts = recentPosts || [];
            reels = recentReels || [];
            routes = featuredRoutes || [];
        } else {
            // Custom tag or topic category (e.g. 'ekipman', 'deniz', 'cafe')
            const tagRegex = new RegExp(`^#?${category}$`, 'i');
            const captionRegex = new RegExp(`#${category}\\b`, 'i');
            const tagFilter = {
                $or: [
                    { tags: category },
                    { tags: tagRegex },
                    { caption: captionRegex }
                ]
            };
            [posts, reels] = await Promise.all([
                Post.find({
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' },
                    ...tagFilter
                })
                    .sort({ createdAt: -1, _id: -1 })
                    .skip(postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean(),
                Reel.find({
                    userId: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    isApproved: true,
                    isPublic: { $ne: false },
                    ...tagFilter
                })
                    .sort({ createdAt: -1, _id: -1 })
                    .skip(reelOffset)
                    .limit(reelPageSize + 1)
                    .lean()
            ]);
        }

        const trimmed = trimDiscoverySources(window, { posts, reels, routes });
        posts = trimmed.posts;
        reels = trimmed.reels;
        routes = trimmed.routes;
        const hasMore = trimmed.hasMore;

        if (reels && reels.length > 0) {
            reels = await hydrateReelUsers(reels);
        }

        // 2) Apply VibeEngine Configuration across ALL content types
        const rankingSeed = userId || 'global';
        const postItems = posts.map(p => ({
            id: `p:${p._id}`,
            score: calculateVibeScore(p, 'post', viewerContext, config, rankingSeed),
            data: enrichFeedItem(p, 'post', userId, savedPostIds, savedReelIds)
        }));

        const reelItems = reels.map(r => ({
            id: `re:${r._id}`,
            score: calculateVibeScore(r, 'reel', viewerContext, config, rankingSeed),
            data: enrichFeedItem(r, 'reel', userId, savedPostIds, savedReelIds)
        }));

        const routeItems = routes.map(rt => ({
            id: `ro:${rt._id}`,
            score: calculateVibeScore(rt, 'route', viewerContext, config, rankingSeed),
            data: enrichFeedItem(rt, 'route', userId, savedPostIds, savedReelIds)
        }));

        // 3) Mix and rank based on category intent
        let combined;
        if (isTrendCategory) {
            combined = [...postItems, ...reelItems].sort((a, b) => (b.score || 0) - (a.score || 0));
        } else if (isRouteCategory) {
            combined = [...routeItems, ...postItems].sort((a, b) => (b.score || 0) - (a.score || 0));
        } else if (isVideoCategory) {
            combined = [...reelItems].sort((a, b) => (b.score || 0) - (a.score || 0));
        } else if (isFollowingCategory) {
            combined = [...postItems, ...reelItems].sort((a, b) => {
                const dateA = new Date(a.data?.createdAt || 0).getTime();
                const dateB = new Date(b.data?.createdAt || 0).getTime();
                if (dateB !== dateA) return dateB - dateA;
                return (b.score || 0) - (a.score || 0);
            });
        } else {
            combined = rankDiscoveryItems(
                [...postItems, ...reelItems, ...routeItems],
                rankingSeed
            );
        }

        const feed = combined.map(item => item.data).filter(Boolean);

        // Inject Sponsored Content only on discovery home (for_you) and trend
        if (isForYouCategory || isTrendCategory) {
            await injectSponsoredContent(feed);
        }

        res.status(200).json({
            status: 'success',
            results: feed.length,
            data: { items: feed, feed, page, hasMore }
        });

    } catch (error) {
        console.error('VibeEngine Error:', error);
        res.status(500).json({ status: 'error', message: 'Keşfet yüklenemedi.', requestId: req.id });
    }
};

// --- Helper: Inject Sponsored Content ---
const injectSponsoredContent = async (feed) => {
    if (!getRuntimeCapabilities().shop || feed.length <= 5) return;

    const config = await getConfig();
    if (!config.sponsored?.enabled) return;

    try {
        // Use Global Cache for Products
        const now = Date.now();
        if (!cachedSponsoredProducts || (now - lastProductFetch > PROD_CACHE_TTL)) {
            const products = await mongoose.model('Product').find({
                stock: { $gt: 0 },
                rating: { $gte: config.sponsored.minRating || 4.5 }
            }).limit(5).lean();

            cachedSponsoredProducts = products;
            lastProductFetch = now;
            console.log('📦 Sponsored Products Cache Updated');
        }

        if (cachedSponsoredProducts && cachedSponsoredProducts.length > 0) {
            let injectIndex = config.sponsored.frequency || 8;
            let prodIndex = 0;

            while (injectIndex < feed.length && prodIndex < cachedSponsoredProducts.length) {
                const product = cachedSponsoredProducts[prodIndex];

                const sponsoredItem = {
                    ...product,
                    _id: `sponsored_${product._id}`,
                    productId: product._id,
                    type: 'product',
                    isSponsored: true,
                    user: {
                        name: 'MotoVibe Shop',
                        username: 'motovibe_shop',
                        avatar: 'https://motovibe.vercel.app/logo-square.png',
                        rank: 'Official Partner'
                    },
                    content: product.description,
                    images: product.images || [product.image],
                    likes: 0,
                    comments: 0,
                    createdAt: new Date()
                };

                feed.splice(injectIndex, 0, sponsoredItem);
                injectIndex += (config.sponsored.frequency || 8) + 1;
                prodIndex++;
            }
        }
    } catch (err) {
        console.error('Sponsored injection error:', err);
    }
};

// --- ADMIN CONTROLLERS ---

export const getVibeSettings = async (req, res) => {
    try {
        const config = await getConfig();
        res.status(200).json({ status: 'success', data: config });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateVibeSettings = async (req, res) => {
    try {
        const updates = req.body;
        const existing = await VibeConfig.findById('default_config').lean();

        let finalUpdates = { ...updates };

        if (existing) {
            if (updates.timeDecay) {
                finalUpdates.timeDecay = {
                    ...existing.timeDecay,
                    ...updates.timeDecay
                };
                if (finalUpdates.timeDecay.maxAgeDays === undefined) {
                    finalUpdates.timeDecay.maxAgeDays = 30;
                }
            }
            if (updates.weights) {
                finalUpdates.weights = { ...existing.weights, ...updates.weights };
            }
            if (updates.multipliers) {
                finalUpdates.multipliers = { ...existing.multipliers, ...updates.multipliers };
            }
            if (updates.sponsored) {
                finalUpdates.sponsored = { ...existing.sponsored, ...updates.sponsored };
            }
            if (updates.telemetryConfig) {
                finalUpdates.telemetryConfig = { ...(existing.telemetryConfig || {}), ...updates.telemetryConfig };
            }
        }

        const config = await VibeConfig.findByIdAndUpdate(
            'default_config',
            { ...finalUpdates, lastUpdated: Date.now() },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        // Invalidate Config Cache
        try {
            await redis.del('vibe:config');

            // Invalidate ALL user feed caches so they get new algorithm immediately
            const keys = await redis.keys('feed:discover:*');
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } catch (redisErr) {
            console.warn('⚠️ VibeEngine Cache Invalidation Failed:', redisErr.message);
        }

        res.status(200).json({ status: 'success', data: config, message: 'Settings updated & Caches cleared' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
