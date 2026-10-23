import { selectDiscoverySources,countDiscovery } from './query.service.js';
import { readDiscoveryCursor,discoveryCursorScope,nextDiscoveryCursor } from './cursor.service.js';
import AppError from "../../utils/appError.js";

import User from "../users/model.js";
import VibeConfig from "./model.js";
import mongoose from 'mongoose';
import redis from "../../config/redis.js";
import { trimDiscoverySources } from "./discoveryPaging.service.js";

import { buildViewerContext,canonicalizeCategory,calculateVibeScore,rankDiscoveryItems } from './ranking.service.js';
export * from './ranking.service.js';
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
export const buildDiscoveryPage = async ({userId,query={},postsOnly=false}) => {

        let page = query.page === undefined ? 1 : Number(query.page);
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
            throw new AppError('Geçersiz sayfa.',400);
        }
        const limit = 20;
        const rawCategory = query.category || '';
        const category = canonicalizeCategory(rawCategory);
        const { blockedUsers, savedPostIds, savedReelIds, viewerContext, followingIds = [] } =
            await getViewerFeedContext(userId);
        const scope=discoveryCursorScope({userId:userId || null,category,postsOnly,limit:query.limit || null,q:query.q || null,
            blockedUsers:[...blockedUsers].sort(),followingIds:[...followingIds].sort(),viewerContext});
        const cursor=query.cursor!==undefined || query.pagination==='cursor'
            ? readDiscoveryCursor(query.cursor ?? 'start',scope) : null;
        if(cursor)page=cursor.page;
        // Fetch a new, disjoint source window for every requested page.
        const config = await getConfig();
        const decay = config.timeDecay || {};

        const daysToLookBack = decay.maxAgeDays || 60;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToLookBack);

        let {posts,reels,routes,window,legacyFilter,isVideoCategory,isRouteCategory,isTrendCategory,isFollowingCategory}=await selectDiscoverySources({category,page,query,postsOnly,blockedUsers,followingIds,cursor});
        const rawSources={posts,reels,routes};
        const trimmed = trimDiscoverySources(window, rawSources);
        const nextCursor=nextDiscoveryCursor(cursor,window,rawSources,trimmed,trimmed.hasMore);
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

        const total = postsOnly ? await countDiscovery('posts',legacyFilter) : undefined;
        return { status:'success', results:feed.length,
            ...(postsOnly ? {total,page,pages:Math.ceil(total/window.postSize)} : {}),
            data:{items:feed,feed,posts:feed,page,hasMore,...(cursor ? {nextCursor} : {})},
            ...(cursor ? {meta:{pagination:'cursor',nextCursor,snapshot:cursor.snapshot}} : {}) };


};
