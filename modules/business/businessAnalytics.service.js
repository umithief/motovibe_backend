import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import mongoose from 'mongoose';

import Appointment from "../appointments/model.js";
import BusinessAnalyticsEvent from "./BusinessAnalyticsEvent.model.js";
import User from "../users/model.js";
import AppError from "../../utils/appError.js";


const EVENT_TYPES = new Set(['PROFILE_VIEW', 'CATALOG_VIEW', 'CATALOG_ITEM_CLICK']);

export const calculateBusinessFunnelMetrics = ({ profileViews = 0, appointmentCounts = {} } = {}) => {
    const appointmentRequests = Object.values(appointmentCounts)
        .reduce((sum, value) => sum + Number(value || 0), 0);
    const convertedAppointments =
        Number(appointmentCounts.approved || 0) +
        Number(appointmentCounts.inProgress || 0) +
        Number(appointmentCounts.completed || 0);
    return {
        appointmentRequests,
        convertedAppointments,
        completedAppointments: Number(appointmentCounts.completed || 0),
        bookingConversionRate: profileViews > 0
            ? Number(Math.min((appointmentRequests / profileViews) * 100, 100).toFixed(1))
            : 0,
        approvalRate: appointmentRequests > 0
            ? Number(((convertedAppointments / appointmentRequests) * 100).toFixed(1))
            : 0
    };
};

export const recordBusinessAnalyticsEvent = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const businessId = String(input.body?.businessId || '').trim();
    const eventType = String(input.body?.eventType || '').trim().toUpperCase();
    const catalogItemId = String(input.body?.catalogItemId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(businessId) || !EVENT_TYPES.has(eventType)) {
        return throwError(new AppError('Analitik olayı geçersiz.', 400));
    }
    if (businessId === String(input.user.id)) {
        return respond({ status: 'success', data: { recorded: false } },202);
    }
    if (eventType === 'CATALOG_ITEM_CLICK' && !mongoose.Types.ObjectId.isValid(catalogItemId)) {
        return throwError(new AppError('Katalog ürünü geçersiz.', 400));
    }

    const business = await User.findOne({ _id: businessId, userType: 'PROFESSIONAL' })
        .select('businessProfile.catalogItems');
    if (!business) return throwError(new AppError('İşletme bulunamadı.', 404));
    if (eventType === 'CATALOG_ITEM_CLICK') {
        const itemExists = (business.businessProfile?.catalogItems || []).some(
            (item) => String(item._id) === catalogItemId && item.isActive !== false
        );
        if (!itemExists) return throwError(new AppError('Katalog ürünü bulunamadı.', 404));
    }

    const dayBucket = new Date().toISOString().slice(0, 10);
    await BusinessAnalyticsEvent.updateOne(
        {
            businessId,
            actorId: input.user.id,
            eventType,
            catalogItemId: catalogItemId || null,
            dayBucket
        },
        {
            $setOnInsert: {
                businessId,
                actorId: input.user.id,
                eventType,
                catalogItemId: catalogItemId || undefined,
                dayBucket
            }
        },
        { upsert: true }
    );
    respond({ status: 'success', data: { recorded: true } },202);

    return response;
};

export const getBusinessAnalyticsDashboard = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const periodDays = Math.min(Math.max(parseInt(input.query.days, 10) || 30, 7), 90);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const business = await User.findById(input.user.id)
        .select('userType businessProfile.catalogItems businessProfile.ratingAverage businessProfile.ratingCount')
        .lean();
    if (!business || business.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('BİZ analitikleri için işletme hesabı gerekir.', 403));
    }

    const [eventRows, visitorRows, appointmentRows, topClickRows] = await Promise.all([
        BusinessAnalyticsEvent.aggregate([
            { $match: { businessId: business._id, createdAt: { $gte: since } } },
            { $group: { _id: '$eventType', count: { $sum: 1 } } }
        ]),
        BusinessAnalyticsEvent.aggregate([
            {
                $match: {
                    businessId: business._id,
                    eventType: 'PROFILE_VIEW',
                    createdAt: { $gte: since }
                }
            },
            { $group: { _id: '$actorId' } },
            { $count: 'count' }
        ]),
        Appointment.aggregate([
            { $match: { businessId: business._id, createdAt: { $gte: since } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        BusinessAnalyticsEvent.aggregate([
            {
                $match: {
                    businessId: business._id,
                    eventType: 'CATALOG_ITEM_CLICK',
                    createdAt: { $gte: since },
                    catalogItemId: { $ne: null }
                }
            },
            { $group: { _id: '$catalogItemId', clicks: { $sum: 1 } } },
            { $sort: { clicks: -1 } },
            { $limit: 5 }
        ])
    ]);

    const events = Object.fromEntries(eventRows.map((row) => [row._id, row.count]));
    const appointments = Object.fromEntries(appointmentRows.map((row) => [row._id, row.count]));
    const profileViews = events.PROFILE_VIEW || 0;
    const funnel = calculateBusinessFunnelMetrics({
        profileViews,
        appointmentCounts: appointments
    });
    const catalogItems = business.businessProfile?.catalogItems || [];
    const topCatalogItems = topClickRows.map((row) => {
        const item = catalogItems.find((candidate) => String(candidate._id) === String(row._id));
        return { itemId: row._id, name: item?.name || 'Katalog ürünü', clicks: row.clicks };
    });

    respond({
        status: 'success',
        data: {
            periodDays,
            profileViews,
            uniqueVisitors: visitorRows[0]?.count || 0,
            catalogViews: events.CATALOG_VIEW || 0,
            catalogClicks: events.CATALOG_ITEM_CLICK || 0,
            ...funnel,
            ratingAverage: business.businessProfile?.ratingAverage || 0,
            ratingCount: business.businessProfile?.ratingCount || 0,
            topCatalogItems
        }
    },200);

    return response;
};
