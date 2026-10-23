import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';

import { raiseHttpError } from '../../utils/httpError.js';


import mongoose from 'mongoose';

import Analytics from "./model.js";



import { SLIDE_EVENT_TYPES, FEED_EVENT_TYPES, summarizeFeedAnalytics } from './rules.service.js';

export const postVisit=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

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

        respond({ message: 'Visit recorded' },200);
    } catch (error) { throw error; }

    return response;
};

export const getVisitors=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const Visitor = mongoose.model('Visitor');
        const today = new Date().toLocaleDateString('tr-TR');

        const allStats = await Visitor.find();

        const totalVisits = allStats.reduce((sum, item) => sum + item.count, 0);
        const todayEntry = allStats.find(s => s.date === today);

        respond({
            totalVisits,
            todayVisits: todayEntry ? todayEntry.count : 0
        },200);
    } catch (error) { throw error; }

    return response;
};

export const postEvent=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const eventData = input.body || {};

        if (typeof eventData.type !== 'string' || !eventData.type.trim()) {
            return raiseHttpError({ message: 'Event type required' },400);
        }

        const eventType = eventData.type.trim();

        if (eventType.startsWith('feed_') && !FEED_EVENT_TYPES.has(eventType)) {
            return raiseHttpError({ message: 'Unsupported feed event' },400);
        }

        if (eventType.startsWith('slide_') && !SLIDE_EVENT_TYPES.has(eventType)) {
            return raiseHttpError({ message: 'Unsupported slide event' },400);
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
                return raiseHttpError({ message: 'Post id required' },400);
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
        respond({ message: 'Event tracked' },201);
    } catch (error) { throw error; }

    return response;
};

export const getDashboard=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { range } = input.query; // '24h', '7d', '30d'
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

        respond({
            totalProductViews,
            totalAddToCart,
            totalCheckouts,
            avgSessionDuration,
            topViewedProducts,
            topAddedProducts,
            feedAnalytics,
            activityTimeline
        },200);

    } catch (error) { throw error; }

    return response;
};
