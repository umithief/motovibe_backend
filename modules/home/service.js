import Route from "../routes/model.js";
import GroupRide from "../rides/GroupRide.model.js";
import Post from "../posts/model.js";
import Slide from "../slides/model.js";
import Campaign from "../campaigns/model.js";
import VibeConfig from "../discovery/model.js";
import { getRuntimeCapabilities } from '../../config/release.js';
import { publicSummaryCache } from './cache.service.js';
export const buildHomeSummary = async ({user,cache=publicSummaryCache}={}) => {
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
        ] = await cache.get('home:summary:public:v1', () => Promise.all([
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
        ]));

        const nextRideQuery = {
            status: { $in: ['scheduled', 'active'] },
            $or: [
                { date: { $gt: todayStr } },
                { date: todayStr, time: { $gte: currentTime } }
            ]
        };
        const [nextRide, joinedRide] = await Promise.all([
            GroupRide.findOne(nextRideQuery).sort({ date: 1, time: 1 }).lean(),
            user
                ? GroupRide.findOne({
                    status: nextRideQuery.status,
                    $and: [
                        { $or: nextRideQuery.$or },
                        { $or: [
                            { 'participants.userId': user._id },
                            { 'organizer.userId': user._id }
                        ] }
                    ]
                }).sort({ date: 1, time: 1 }).lean()
                : Promise.resolve(null)
        ]);
        const upcomingRide = nextRide
            ? {
                ...nextRide,
                isJoined: Boolean(user && (
                    nextRide.organizer?.userId?.toString() === user._id.toString() ||
                    nextRide.participants?.some(participant =>
                        participant.userId?.toString() === user._id.toString()
                    )
                ))
            }
            : null;
        const userJoinedRide = joinedRide ? { ...joinedRide, isJoined: true } : null;

        let showcaseEnabled = getRuntimeCapabilities().shop;
        if (showcaseEnabled && vibeConfig && vibeConfig.config && vibeConfig.config.showcaseEnabled !== undefined) {
            showcaseEnabled = vibeConfig.config.showcaseEnabled;
        }

        return {
            routesTotal,
            ridesTotal,
            upcomingRide,
            joinedRide: userJoinedRide,
            featuredRoute,
            highlightPost,
            slides: slides || [],
            campaigns: campaigns || [],
            showcaseEnabled
        };

};
