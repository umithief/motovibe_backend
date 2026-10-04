import express from 'express';
import mongoose from 'mongoose';
import { admin, protect } from '../middleware/authMiddleware.js';
import Analytics from '../models/Analytics.js';

const router = express.Router();

const SLIDE_EVENT_TYPES = new Set([
    'slide_view',
    'slide_click',
]);

const FEED_EVENT_TYPES = new Set([
    'feed_impression',
    'feed_dwell',
    'feed_like',
    'feed_unlike',
    'feed_save',
    'feed_unsave',
    'feed_share_open',
    'feed_comments_open',
    'feed_sponsor_cta',
]);

const protectFeedAnalytics = (req, res, next) => {
    const eventType = typeof req.body?.type === 'string'
        ? req.body.type.trim()
        : '';
    if (eventType.startsWith('feed_')) {
        return protect(req, res, next);
    }
    return next();
};

export const summarizeFeedAnalytics = (events = []) => {
    const summary = {
        impressions: 0,
        sponsoredImpressions: 0,
        likes: 0,
        saves: 0,
        shares: 0,
        commentsOpened: 0,
        sponsorCtaClicks: 0,
        averageDwellMs: 0,
        sponsorCtr: 0,
    };
    let dwellTotal = 0;
    let dwellSamples = 0;

    for (const event of events) {
        if (event.type === 'feed_impression') {
            summary.impressions++;
            if (event.isSponsored === true) summary.sponsoredImpressions++;
        }
        else if (event.type === 'feed_like') summary.likes++;
        else if (event.type === 'feed_save') summary.saves++;
        else if (event.type === 'feed_share_open') summary.shares++;
        else if (event.type === 'feed_comments_open') summary.commentsOpened++;
        else if (event.type === 'feed_sponsor_cta') summary.sponsorCtaClicks++;
        else if (event.type === 'feed_dwell' && Number(event.durationMs) > 0) {
            dwellTotal += Number(event.durationMs);
            dwellSamples++;
        }
    }

    summary.averageDwellMs = dwellSamples > 0
        ? Math.round(dwellTotal / dwellSamples)
        : 0;
    summary.sponsorCtr = summary.sponsoredImpressions > 0
        ? Number((summary.sponsorCtaClicks / summary.sponsoredImpressions).toFixed(4))
        : 0;
    return summary;
};

// POST /api/analytics/visit
router.post('/visit', async (req, res) => {
    try {
        const Visitor = mongoose.model('Visitor');
        const today = new Date().toLocaleDateString('tr-TR');

        // Find today's entry or create it
        let todayStats = await Visitor.findOne({ date: today });

        if (todayStats) {
            todayStats.count += 1;
            await todayStats.save();
        } else {
            todayStats = new Visitor({ date: today, count: 1 });
            await todayStats.save();
        }

        res.status(200).json({ message: 'Visit recorded' });
    } catch (error) {
        console.error('Visit error:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET /api/analytics/visitors
router.get('/visitors', protect, admin, async (req, res) => {
    try {
        const Visitor = mongoose.model('Visitor');
        const today = new Date().toLocaleDateString('tr-TR');

        const allStats = await Visitor.find();

        const totalVisits = allStats.reduce((sum, item) => sum + item.count, 0);
        const todayEntry = allStats.find(s => s.date === today);

        res.json({
            totalVisits,
            todayVisits: todayEntry ? todayEntry.count : 0
        });
    } catch (error) {
        res.status(500).json({ totalVisits: 0, todayVisits: 0 });
    }
});

// POST /api/analytics/event
router.post('/event', protectFeedAnalytics, async (req, res) => {
    try {
        const eventData = req.body || {};

        if (typeof eventData.type !== 'string' || !eventData.type.trim()) {
            return res.status(400).json({ message: 'Event type required' });
        }

        const eventType = eventData.type.trim();

        if (eventType.startsWith('feed_') && !FEED_EVENT_TYPES.has(eventType)) {
            return res.status(400).json({ message: 'Unsupported feed event' });
        }
        
        if (eventType.startsWith('slide_') && !SLIDE_EVENT_TYPES.has(eventType)) {
            return res.status(400).json({ message: 'Unsupported slide event' });
        }

        const isFeedEvent = FEED_EVENT_TYPES.has(eventType);
        const isSlideEvent = SLIDE_EVENT_TYPES.has(eventType);
        
        let cleanEvent = eventData;
        if (isFeedEvent) {
             cleanEvent = {
                type: eventType,
                postId: String(eventData.postId || '').slice(0, 80),
                contentType: ['post', 'reel', 'route', 'ad'].includes(eventData.contentType)
                    ? eventData.contentType
                    : 'post',
                source: String(eventData.source || 'unknown').slice(0, 32),
                isSponsored: eventData.isSponsored === true,
                ...(eventType === 'feed_dwell' ? {
                    durationMs: Math.min(
                        Math.max(Number(eventData.durationMs) || 0, 0),
                        30 * 60 * 1000
                    )
                } : {})
            };
            if (!cleanEvent.postId) {
                return res.status(400).json({ message: 'Post id required' });
            }
        } else if (isSlideEvent) {
             cleanEvent = {
                 type: eventType,
                 slideId: String(eventData.slideId || '').slice(0, 80),
                 title: String(eventData.title || '').slice(0, 100),
                 actionType: String(eventData.actionType || '').slice(0, 50),
                 actionTarget: String(eventData.actionTarget || '').slice(0, 200),
                 index: Number(eventData.index) || 0,
             };
        }

        const newEvent = new Analytics({
            ...cleanEvent,
            timestamp: Date.now(),
            date: new Date().toLocaleDateString('tr-TR')
        });

        await newEvent.save();
        res.status(201).json({ message: 'Event tracked' });
    } catch (error) {
        console.error('Event error:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET /api/analytics/dashboard
router.get('/dashboard', protect, admin, async (req, res) => {
    try {
        const { range } = req.query; // '24h', '7d', '30d'
        const now = Date.now();
        let startTime = 0;

        if (range === '24h') startTime = now - (24 * 60 * 60 * 1000);
        else if (range === '30d') startTime = now - (30 * 24 * 60 * 60 * 1000);
        else startTime = now - (7 * 24 * 60 * 60 * 1000); // Default 7d

        const events = await Analytics.find({ timestamp: { $gte: startTime } });

        // Aggregation Logic (Similar to Frontend Mock Logic)
        const productViews = {};
        const productAdds = {};
        let totalProductViews = 0;
        let totalAddToCart = 0;
        let totalCheckouts = 0;
        let totalDuration = 0;
        let durationCount = 0;

        events.forEach(e => {
            if (e.type === 'view_product') {
                totalProductViews++;
                if (e.productName) {
                    productViews[e.productName] = (productViews[e.productName] || 0) + 1;
                }
            } else if (e.type === 'add_to_cart') {
                totalAddToCart++;
                if (e.productName) {
                    productAdds[e.productName] = (productAdds[e.productName] || 0) + 1;
                }
            } else if (e.type === 'checkout_start') {
                totalCheckouts++;
            } else if (e.type === 'session_duration' && e.duration) {
                totalDuration += e.duration;
                durationCount++;
            }
        });

        // Build Timeline
        let activityTimeline = [];

        if (range === '24h') {
            const currentHour = new Date().getHours();
            // Initialize last 12-24h
            // Simplified: Just buckets for 24h
            const buckets = {};

            events.forEach(e => {
                const d = new Date(e.timestamp);
                const h = d.getHours();
                buckets[h] = (buckets[h] || 0) + 1;
            });

            for (let i = 0; i < 12; i++) {
                const h = (currentHour - 11 + i + 24) % 24;
                activityTimeline.push({ label: `${h}:00`, value: buckets[h] || 0 });
            }

        } else {
            const daysCount = range === '30d' ? 30 : 7;
            const buckets = {};

            events.forEach(e => {
                const day = new Date(e.timestamp).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
                buckets[day] = (buckets[day] || 0) + 1;
            });

            for (let i = daysCount - 1; i >= 0; i--) {
                const d = new Date(now - (i * 24 * 60 * 60 * 1000));
                const label = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
                activityTimeline.push({ label, value: buckets[label] || 0 });
            }
        }

        const topViewedProducts = Object.entries(productViews)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const topAddedProducts = Object.entries(productAdds)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const avgSessionDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
        const feedAnalytics = summarizeFeedAnalytics(events);

        res.json({
            totalProductViews,
            totalAddToCart,
            totalCheckouts,
            avgSessionDuration,
            topViewedProducts,
            topAddedProducts,
            feedAnalytics,
            activityTimeline
        });

    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ message: error.message });
    }
});

export default router;
