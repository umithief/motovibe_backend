import mongoose from 'mongoose';
import { escapeRegex } from '../utils/tagUtils.js';

const getUser = () => mongoose.model('User');
const getSocialPost = () => mongoose.model('SocialPost');
const getRoute = () => mongoose.model('Route');
const getPack = () => mongoose.model('Pack');
const getTag = () => mongoose.model('Tag');
const getReel = () => mongoose.model('Reel');

/** -------------------------------------------------------
 *  GET /api/explore/search?q={query}
 *  Universal search: Riders, Packs, Routes, Reels, Posts, Tags
 * ------------------- */
export const universalSearch = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 1) {
            return res.json({ riders: [], packs: [], routes: [], reels: [], posts: [], hashtags: [] });
        }

        const cleanQ = q.replace(/^#/, '').trim(); // Remove # if present for array searches
        const regex = new RegExp(escapeRegex(q), 'i');
        const partialTagRegex = new RegExp(escapeRegex(cleanQ), 'i');

        const User = getUser();
        const SocialPost = getSocialPost();
        const Route = getRoute();
        const Pack = getPack();
        const Tag = getTag();
        const Reel = getReel();

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
            Route.aggregate([
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
            Reel.find({
                $or: [
                    { caption: regex },
                    { tags: partialTagRegex }
                ]
            }).limit(15).lean(),

            // ---------- POSTS ----------
            SocialPost.find({
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

        return res.json({ 
            riders, 
            packs, 
            routes,
            reels,
            posts,
            hashtags 
        });
    } catch (err) {
        console.error('[ExploreController] universalSearch error:', err);
        return res.status(500).json({ message: 'Arama hatası', error: err.message });
    }
};

/** -------------------------------------------------------
 *  GET /api/explore/trending
 *  Returns mixed trending items: posts + routes
 *  Shape: { items: [{ type, ...fields }] }
 * ------------------------------------------------------- */
import { rankAndInterleaveTrending } from '../services/exploreRankingEngine.js';

export const getTrending = async (req, res) => {
    try {
        const SocialPost = getSocialPost();
        const Route = getRoute();

        // 1. Fetch candidate pool prioritizing telemetry and media
        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);

        const [posts, routes] = await Promise.all([
            SocialPost.find({ 
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

            Route.find({})
            .limit(30)
            .lean()
        ]);

        // 2. Score, filter, and interleave using Apex Ranking Engine
        const items = rankAndInterleaveTrending(posts, routes, {
            maxPosts: 14,
            maxRoutes: 7
        });

        return res.json({ items });
    } catch (err) {
        console.error('[ExploreController] getTrending error:', err);
        return res.status(500).json({ message: 'Trending hatası', error: err.message });
    }
};
