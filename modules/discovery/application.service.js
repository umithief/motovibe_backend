import { findDiscovery,aggregateDiscovery } from './query.service.js';
import { getConfig } from './feed.service.js';
import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { discoveryPostFilter,discoveryReelFilter } from './access.service.js';

import mongoose from 'mongoose';
import { escapeRegex } from "../../utils/tagUtils.js";

const getUser = () => mongoose.model('User');
const getPack = () => mongoose.model('Pack');
const getTag = () => mongoose.model('Tag');

/** -------------------------------------------------------
 *  GET /api/explore/search?q={query}
 *  Universal search: Riders, Packs, Routes, Reels, Posts, Tags
 * ------------------- */
export const universalSearch = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const q = (input.query.q || '').trim();
        if (!q || q.length < 1) {
            return respond({ riders: [], packs: [], routes: [], reels: [], posts: [], hashtags: [] },200);
        }

        const cleanQ = q.replace(/^#/, '').trim(); // Remove # if present for array searches
        const regex = new RegExp(escapeRegex(q), 'i');
        const partialTagRegex = new RegExp(escapeRegex(cleanQ), 'i');

        const User = getUser();
        const Pack = getPack();
        const Tag = getTag();

        // Run all queries in parallel
        const [riders, packs, routes, reels, posts, hashtags] = await Promise.all([

            // ---------- RIDERS ----------
            User.aggregate([
                {
                    $match: {
                        $or: [
                            { name: regex },
                            { username: regex },
                            { 'garage.model': regex },
                            { 'garage.brand': regex },
                            { primaryBike: regex },
                            {
                                $and: [
                                    { userType: 'PROFESSIONAL' },
                                    {
                                        $or: [
                                            { activeProfileMode: 'PROFESSIONAL' },
                                            { activeProfileMode: { $exists: false } }
                                        ]
                                    },
                                    { 'businessProfile.services': regex }
                                ]
                            },
                        ],
                    },
                },
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        username: 1,
                        avatar: 1,
                        primaryBike: 1,
                        rank: 1,
                        isVerified: 1,
                        userType: 1,
                        activeProfileMode: 1,
                        businessProfile: 1,
                        bikeStyle: { $ifNull: [{ $arrayElemAt: ['$garage.style', 0] }, 'NAKED'] },
                    },
                },
                { $limit: 10 },
            ]),

            // ---------- PACKS ----------
            Pack.aggregate([
                {
                    $match: {
                        $or: [{ name: regex }, { tag: regex }],
                    },
                },
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        tag: 1,
                        emblem: 1,
                        isPrivate: 1,
                        memberCount: { $size: { $ifNull: ['$members', []] } },
                    },
                },
                { $limit: 10 },
            ]),

            // ---------- ROUTES ----------
            aggregateDiscovery('routes',[
                {
                    $match: {
                        $or: [
                            { title: regex },
                            { description: regex },
                            { location: regex },
                        ],
                    },
                },
                { $limit: 10 },
            ]),

            // ---------- REELS (VibeCuts) ----------
            findDiscovery('reels',{
                ...discoveryReelFilter({blockedUsers:input.user?.blockedUsers || []}),
                $or: [
                    { caption: regex },
                    { tags: partialTagRegex }
                ]
            }).limit(15).lean(),

            // ---------- POSTS ----------
            findDiscovery('posts',{
                ...discoveryPostFilter({blockedUsers:input.user?.blockedUsers || []}),
                $or: [
                    { caption: regex },
                    { content: regex },
                    { tags: partialTagRegex }
                ]
            }).limit(15).lean(),

            // ---------- HASHTAGS (Tags) ----------
            Tag.find({
                $or: [
                    { name: partialTagRegex },
                    { displayName: partialTagRegex }
                ]
            }).sort({ postCount: -1 }).limit(15).lean()
        ]);

        return respond({
            riders,
            packs,
            routes,
            reels,
            posts,
            hashtags
        },200);
    } catch (err) { throw err; }

    return response;
};

/** -------------------------------------------------------
 *  GET /api/explore/trending
 *  Returns mixed trending items: posts + routes
 *  Shape: { items: [{ type, ...fields }] }
 * ------------------------------------------------------- */
import { rankAndInterleaveTrending } from "./service.js";

export const getTrending = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {

        // 1. Fetch candidate pool prioritizing telemetry and media
        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);

        const [posts, routes] = await Promise.all([
            findDiscovery('posts',{
                ...discoveryPostFilter({blockedUsers:input.user?.blockedUsers || []}),
                createdAt: { $gte: last30Days },
                isDeleted: { $ne: true },
                $or: [
                    { 'telemetry.speed': { $gt: 0 } },
                    { 'telemetry.leanAngle': { $gt: 0 } },
                    { 'rideStats.maxSpeed': { $gt: 0 } },
                    { 'media.0': { $exists: true } },
                    { images: { $not: { $size: 0 } } }
                ]
            })
            .populate('user', 'name username avatar rank isVerified')
            .limit(60)
            .lean(),

            findDiscovery('routes',{})
            .limit(30)
            .lean()
        ]);

        // 2. Score, filter, and interleave using Apex Ranking Engine
        const items = rankAndInterleaveTrending(posts, routes, {
            config:await getConfig(),
            seed:input.user?._id?.toString() || 'global',
            maxPosts: 14,
            maxRoutes: 7
        });

        return respond({ items },200);
    } catch (err) { throw err; }

    return response;
};
