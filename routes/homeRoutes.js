import express from 'express';
import { checkUser } from '../middleware/authMiddleware.js';
import Route from '../models/Route.js';
import GroupRide from '../models/GroupRide.js';
import Post from '../models/Post.js';
import Slide from '../models/Slide.js';
import Campaign from '../models/Campaign.js';
import VibeConfig from '../models/VibeConfig.js';

const router = express.Router();

router.get('/summary', checkUser, async (req, res) => {
    try {
        const now = new Date();
        const localDateParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Istanbul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(now);
        const localTimeParts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Istanbul',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(now);
        const partValue = (parts, type) => parts.find(part => part.type === type)?.value || '';
        const todayStr = `${partValue(localDateParts, 'year')}-${partValue(localDateParts, 'month')}-${partValue(localDateParts, 'day')}`;
        const currentTime = `${partValue(localTimeParts, 'hour')}:${partValue(localTimeParts, 'minute')}`;

        const [
            routesTotal,
            ridesTotal,
            featuredRoute,
            highlightPost,
            slides,
            campaigns,
            vibeConfig
        ] = await Promise.all([
            // Filter non-deleted routes
            Route.countDocuments({ isDeleted: { $ne: true } }),
            // Filter active/scheduled rides (exclude cancelled or deleted)
            GroupRide.countDocuments({ status: { $nin: ['cancelled', 'deleted'] } }),
            // Look for isFeatured route first, fallback to highest rated / most ridden route
            Route.findOne({ isFeatured: true, isDeleted: { $ne: true } }).lean().then(async (res) => {
                if (res) return res;
                return Route.findOne({ isDeleted: { $ne: true } })
                    .sort({ rating: -1, riderCount: -1, createdAt: -1 })
                    .lean();
            }),
            // Query most liked public post by likeCount
            Post.findOne({ isDeleted: { $ne: true }, visibility: 'PUBLIC' })
                .sort({ likeCount: -1, createdAt: -1 })
                .lean(),
            (typeof Slide.getActiveSlides === 'function') 
                ? Slide.getActiveSlides() 
                : Slide.find({ isActive: true }).sort({ order: 1 }).lean(),
            Campaign.find({ isActive: true, status: 'active' }).lean(),
            VibeConfig.findOne({}).lean()
        ]);

        const nextRideQuery = {
            status: { $in: ['scheduled', 'active'] },
            $or: [
                { date: { $gt: todayStr } },
                { date: todayStr, time: { $gte: currentTime } }
            ]
        };
        const [nextRide, joinedRide] = await Promise.all([
            GroupRide.findOne(nextRideQuery).sort({ date: 1, time: 1 }).lean(),
            req.user
                ? GroupRide.findOne({
                    status: nextRideQuery.status,
                    $and: [
                        { $or: nextRideQuery.$or },
                        { $or: [
                            { 'participants.userId': req.user._id },
                            { 'organizer.userId': req.user._id }
                        ] }
                    ]
                }).sort({ date: 1, time: 1 }).lean()
                : Promise.resolve(null)
        ]);
        const upcomingRide = nextRide
            ? {
                ...nextRide,
                isJoined: Boolean(req.user && (
                    nextRide.organizer?.userId?.toString() === req.user._id.toString() ||
                    nextRide.participants?.some(participant =>
                        participant.userId?.toString() === req.user._id.toString()
                    )
                ))
            }
            : null;
        const userJoinedRide = joinedRide ? { ...joinedRide, isJoined: true } : null;

        let showcaseEnabled = true;
        if (vibeConfig && vibeConfig.config && vibeConfig.config.showcaseEnabled !== undefined) {
            showcaseEnabled = vibeConfig.config.showcaseEnabled;
        }

        res.json({
            routesTotal,
            ridesTotal,
            upcomingRide,
            joinedRide: userJoinedRide,
            featuredRoute,
            highlightPost,
            slides: slides || [],
            campaigns: campaigns || [],
            showcaseEnabled
        });
    } catch (error) {
        console.error('[Home Summary Error]:', error);
        res.status(500).json({ message: error.message });
    }
});

export default router;
