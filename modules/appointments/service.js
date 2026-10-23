import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


﻿import Appointment from "./model.js";
import Notification from "../notifications/model.js";
import { createNotification } from "../notifications/service.js";
import { recordBusinessAudit } from "../business/businessAuditService.service.js";
import { createSettlementForCompletedAppointment } from "../business/service.js";

import AppError from "../../utils/appError.js";
import User from "../users/model.js";
import mongoose from 'mongoose';

const ALLOWED_STATUSES = new Set([
    'pending',
    'approved',
    'rejected',
    'inProgress',
    'completed',
    'cancelled'
]);
export const ACTIVE_APPOINTMENT_STATUSES = Object.freeze([
    'pending',
    'approved',
    'inProgress'
]);
const WEEKDAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MAX_APPOINTMENT_MINUTES = 480;
// A pending request holds its slot, so one rider must not be able to fill a
// workshop's calendar with unanswered requests.
export const MAX_PENDING_REQUESTS_PER_BUSINESS = 3;

// Booking is check-then-insert, so two riders racing for one slot would both
// pass the check. The API runs as a single process (ecosystem.config.cjs:
// fork, 1 instance), so serialising bookings per business closes the race.
const businessBookingQueues = new Map();
export const withBusinessBookingLock = async (businessId, task) => {
    const key = String(businessId);
    const previous = businessBookingQueues.get(key) || Promise.resolve();
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => turn);
    businessBookingQueues.set(key, queued);
    await previous;
    try {
        return await task();
    } finally {
        release();
        if (businessBookingQueues.get(key) === queued) businessBookingQueues.delete(key);
    }
};
const APPOINTMENT_NOTIFICATION_TYPE = Object.freeze({
    approved: 'APPOINTMENT_APPROVED',
    rejected: 'APPOINTMENT_REJECTED',
    inProgress: 'APPOINTMENT_IN_PROGRESS',
    completed: 'APPOINTMENT_COMPLETED',
    cancelled: 'APPOINTMENT_CANCELLED'
});

// Working hours are the workshop's wall clock (Turkey), never the server's
// timezone: a VPS on UTC would otherwise shift every slot by three hours.
export const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Europe/Istanbul';
const businessClockFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
});
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Calendar day, weekday and minute-of-day of an instant on the business clock. */
export const businessClock = (date) => {
    const parts = Object.fromEntries(
        businessClockFormat.formatToParts(date).map((part) => [part.type, part.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        weekday: WEEKDAY_INDEX[parts.weekday],
        minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
};

/** The instant of a business wall-clock time (day may overflow into the next month). */
export const businessInstant = (year, month, day, minutes) => {
    const guess = Date.UTC(year, month - 1, day, 0, minutes);
    const clock = businessClock(new Date(guess));
    const shownAt = Date.UTC(clock.year, clock.month - 1, clock.day, 0, clock.minutes);
    return new Date(guess - (shownAt - guess));
};

const minutesFromTime = (value) => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
};

export const appointmentFitsWorkingHours = (workingHours, date, durationMin) => {
    if (!Array.isArray(workingHours) || workingHours.length === 0) return false;
    const clock = businessClock(date);
    const slot = workingHours.find((item) => item?.day === WEEKDAY_NAMES[clock.weekday]);
    if (!slot || slot.isClosed) return false;
    const open = minutesFromTime(slot.open);
    const close = minutesFromTime(slot.close);
    if (open === null || close === null || close <= open) return false;
    const start = clock.minutes;
    return start >= open && start + durationMin <= close;
};

export const isAppointmentTransitionAllowed = (from, to) => {
    if (from === to) return true;
    const transitions = {
        pending: new Set(['approved', 'rejected', 'cancelled']),
        approved: new Set(['inProgress', 'cancelled']),
        inProgress: new Set(['completed', 'cancelled'])
    };
    return transitions[from]?.has(to) === true;
};

export const resolveAppointmentService = ({
    requestedService,
    catalogItemId,
    catalogItems = [],
    services = []
}) => {
    const requested = String(requestedService || '').trim();
    if (catalogItemId) {
        if (!mongoose.Types.ObjectId.isValid(String(catalogItemId))) {
            return { error: 'Katalog ürünü geçersiz.' };
        }
        const item = catalogItems.find(
            (entry) => String(entry._id) === String(catalogItemId)
        );
        if (!item || item.isActive === false) {
            return { error: 'Seçilen katalog ürünü artık kullanılamıyor.' };
        }
        const resolved = String(item.name || '').trim();
        return resolved && resolved.length <= 120
            ? { service: resolved }
            : { error: 'Hizmet bilgisi geçersiz.' };
    }
    const declaredServices = services
        .map((item) => String(item).trim().toLocaleLowerCase('tr-TR'));
    if (declaredServices.length &&
        !declaredServices.includes(requested.toLocaleLowerCase('tr-TR'))) {
        return { error: 'Seçilen hizmet bu işletmede sunulmuyor.' };
    }
    return requested && requested.length <= 120
        ? { service: requested }
        : { error: 'Hizmet bilgisi geçersiz.' };
};

// Get appointments for a business or customer
export const getBusinessAppointments = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const user = await User.findById(input.user.id);
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const page = Math.max(parseInt(input.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(input.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const requestedRole = String(input.query.role || '').trim().toLowerCase();
    if (requestedRole && !['business', 'customer'].includes(requestedRole)) {
        return throwError(new AppError('Randevu rolü geçersiz.', 400));
    }
    const requestedStatus = String(input.query.status || '').trim();
    if (requestedStatus && !ALLOWED_STATUSES.has(requestedStatus)) {
        return throwError(new AppError('Randevu durum filtresi geçersiz.', 400));
    }
    const role = requestedRole || (user.userType === 'PROFESSIONAL' ? 'business' : 'customer');
    if (role === 'business' && user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('İşletme randevuları için BİZ hesabı gerekir.', 403));
    }
    // History lists read newest first; the desk reads the agenda oldest first.
    const sortDirection = String(input.query.sort || '').trim().toLowerCase() === 'desc' ? -1 : 1;
    const ownershipFilter = role === 'business'
        ? { businessId: input.user.id }
        : { customerId: input.user.id };
    const filter = requestedStatus
        ? { ...ownershipFilter, status: requestedStatus }
        : ownershipFilter;

    let appointments = [];
    let totalAppointments = 0;

    if (role === 'business') {
        appointments = await Appointment.find(filter)
            .populate('customerId', 'name username avatar')
            .sort({ date: sortDirection })
            .skip(skip)
            .limit(limit);
        totalAppointments = await Appointment.countDocuments(filter);
    } else {
        appointments = await Appointment.find(filter)
            .populate('businessId', 'name username avatar userType businessProfile.businessName')
            .sort({ date: sortDirection })
            .skip(skip)
            .limit(limit);
        totalAppointments = await Appointment.countDocuments(filter);
    }

    const hasMore = skip + appointments.length < totalAppointments;

    respond({
        status: 'success',
        results: appointments.length,
        data: { appointments, page, hasMore }
    },200);

    return response;
};

// Book an appointment
export const bookAppointment = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { businessId, service, date, notes, catalogItemId, durationMin, attachmentUrl } = input.body;
    const normalizedBusinessId = String(businessId || '').trim();
    const requestedService = String(service || '').trim();
    const normalizedNotes = String(notes || '').trim();
    const normalizedAttachmentUrl = String(attachmentUrl || '').trim();

    if (!mongoose.Types.ObjectId.isValid(normalizedBusinessId)) {
        return throwError(new AppError('Geçersiz isletme kimligi.', 400));
    }
    if (normalizedBusinessId === String(input.user.id)) {
        return throwError(new AppError('Kendi işletmenizden randevu alamazsınız.', 400));
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() < Date.now() - 60000) {
        return throwError(new AppError('Randevu tarihi geçersiz.', 400));
    }
    const normalizedDuration = Number(durationMin ?? 60);
    if (!Number.isInteger(normalizedDuration) || normalizedDuration < 15 || normalizedDuration > 480 || normalizedDuration % 15 !== 0) {
        return throwError(new AppError('Randevu süresi 15-480 dakika arasında ve 15 dakikanın katı olmalı.', 400));
    }

    if (normalizedNotes.length > 500) {
        return throwError(new AppError('Not alani en fazla 500 karakter olabilir.', 400));
    }
    if (normalizedAttachmentUrl &&
        !normalizedAttachmentUrl.startsWith('/api/uploads/') &&
        !/^https?:\/\//i.test(normalizedAttachmentUrl)) {
        return throwError(new AppError('Randevu görsel adresi geçersiz.', 400));
    }

    const businessUser = await User.findById(normalizedBusinessId)
        .select('_id userType businessProfile.acceptsAppointments businessProfile.services businessProfile.catalogItems businessProfile.workingHours');
    if (!businessUser || businessUser.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Geçersiz isletme.', 404));
    }

    if (businessUser.businessProfile?.acceptsAppointments === false) {
        return throwError(new AppError('Bu işletme şu anda randevu kabul etmiyor.', 403));
    }
    const serviceResolution = resolveAppointmentService({
        requestedService,
        catalogItemId,
        catalogItems: businessUser.businessProfile?.catalogItems || [],
        services: businessUser.businessProfile?.services || []
    });
    if (serviceResolution.error) {
        return throwError(new AppError(serviceResolution.error, 400));
    }
    const resolvedService = serviceResolution.service;
    if (!appointmentFitsWorkingHours(businessUser.businessProfile?.workingHours, parsedDate, normalizedDuration)) {
        return throwError(new AppError('Seçilen saat işletmenin çalışma saatleri dışında.', 400));
    }
    const conflictEnd = new Date(parsedDate.getTime() + normalizedDuration * 60000);
    // Only bookings that could still be running at the requested start matter.
    const conflictStart = new Date(parsedDate.getTime() - MAX_APPOINTMENT_MINUTES * 60000);
    const appointment = await withBusinessBookingLock(normalizedBusinessId, async () => {
        const pendingRequests = await Appointment.countDocuments({
            businessId: normalizedBusinessId,
            customerId: input.user.id,
            status: 'pending'
        });
        if (pendingRequests >= MAX_PENDING_REQUESTS_PER_BUSINESS) {
            return throwError(new AppError(
                `Bu işletmede yanıt bekleyen ${MAX_PENDING_REQUESTS_PER_BUSINESS} talebin var. Yanıtlanınca yeni talep gönderebilirsin.`,
                429
            ));
        }
        const conflicts = await Appointment.find({
            businessId: normalizedBusinessId,
            status: { $in: ACTIVE_APPOINTMENT_STATUSES },
            date: { $gte: conflictStart, $lt: conflictEnd }
        }).select('date durationMin');
        if (conflicts.some((entry) => new Date(entry.date).getTime() + Number(entry.durationMin || 60) * 60000 > parsedDate.getTime())) {
            return throwError(new AppError('Bu saat artık dolu. Lütfen başka bir saat seçin.', 409));
        }
        return Appointment.create({
            businessId: normalizedBusinessId,
            customerId: input.user.id,
            service: resolvedService,
            date: parsedDate,
            durationMin: normalizedDuration,
            catalogItemId: catalogItemId || undefined,
            notes: normalizedNotes || undefined,
            attachmentUrl: normalizedAttachmentUrl || undefined
        });
    });

    // Notify business
    await createNotification({
        recipient: normalizedBusinessId,
        sender: input.user.id,
        type: 'APPOINTMENT_REQUEST',
        appointment: appointment._id
    });

    respond({
        status: 'success',
        data: { appointment }
    },201);

    return response;
};

export const getAppointmentAvailability = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const businessId = String(input.query.businessId || '').trim();
    const date = new Date(String(input.query.date || ''));
    const durationMin = Number(input.query.durationMin || 60);
    if (!mongoose.Types.ObjectId.isValid(businessId) || Number.isNaN(date.getTime())) {
        return throwError(new AppError('İşletme veya tarih geçersiz.', 400));
    }
    if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 480 || durationMin % 15 !== 0) {
        return throwError(new AppError('Randevu süresi geçersiz.', 400));
    }
    const business = await User.findById(businessId).select('userType businessProfile.acceptsAppointments businessProfile.workingHours');
    if (!business || business.userType !== 'PROFESSIONAL' || business.businessProfile?.acceptsAppointments === false) {
        return respond({ status: 'success', data: { slots: [] } },200);
    }
    // The requested day is read on the business clock, so a client midnight in
    // any form (local, UTC, date-only) lands on the same workshop day.
    const day = businessClock(date);
    const slot = (business.businessProfile?.workingHours || []).find((item) => item?.day === WEEKDAY_NAMES[day.weekday]);
    const open = minutesFromTime(slot?.open);
    const close = minutesFromTime(slot?.close);
    if (!slot || slot.isClosed || open === null || close === null || close <= open) {
        return respond({ status: 'success', data: { slots: [] } },200);
    }
    const dayStart = businessInstant(day.year, day.month, day.day, 0);
    const dayEnd = businessInstant(day.year, day.month, day.day + 1, 0);
    const appointments = await Appointment.find({
        businessId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        date: { $gte: dayStart, $lt: dayEnd }
    }).select('date durationMin');
    const slots = [];
    for (let minute = open; minute + durationMin <= close; minute += 30) {
        const start = businessInstant(day.year, day.month, day.day, minute);
        if (start.getTime() < Date.now()) continue;
        const end = start.getTime() + durationMin * 60000;
        const occupied = appointments.some((entry) => {
            const entryStart = new Date(entry.date).getTime();
            const entryEnd = entryStart + Number(entry.durationMin || 60) * 60000;
            return entryStart < end && entryEnd > start.getTime();
        });
        if (!occupied) slots.push(start.toISOString());
    }
    respond({ status: 'success', data: { slots } },200);

    return response;
};

// Update appointment status
export const updateAppointmentStatus = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { id } = input.params;
    const { status, reason } = input.body;
    const normalizedStatus = String(status || '').trim();
    const normalizedReason = String(reason || '').trim();

    if (!mongoose.Types.ObjectId.isValid(String(id || '').trim())) {
        return throwError(new AppError('Geçersiz randevu kimligi.', 400));
    }

    if (!ALLOWED_STATUSES.has(normalizedStatus)) {
        return throwError(new AppError('Geçersiz randevu durumu.', 400));
    }
    if (normalizedReason.length > 300) {
        return throwError(new AppError('Randevu açıklaması en fazla 300 karakter olabilir.', 400));
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
        return throwError(new AppError('Randevu bulunamadı.', 404));
    }

    const isBusiness = appointment.businessId.toString() === input.user.id;
    const isCustomer = appointment.customerId.toString() === input.user.id;
    const businessStatuses = new Set(['approved', 'rejected', 'inProgress', 'completed', 'cancelled']);

    if (!isBusiness && !isCustomer) {
        return throwError(new AppError('Bu islem icin yetkiniz yok.', 403));
    }
    if (isCustomer && normalizedStatus !== 'cancelled') {
        return throwError(new AppError('Musteri sadece randevuyu iptal edebilir.', 403));
    }
    if (isBusiness && !businessStatuses.has(normalizedStatus)) {
        return throwError(new AppError('Isletme bu duruma gecis yapamaz.', 400));
    }
    if (isBusiness && normalizedStatus === 'rejected' && normalizedReason.length < 3) {
        return throwError(new AppError('Reddetme nedeni en az 3 karakter olmalıdır.', 400));
    }
    if (['completed', 'rejected', 'cancelled'].includes(appointment.status) && normalizedStatus !== appointment.status) {
        return throwError(new AppError('Sonuçlanmış randevu yeniden açılamaz.', 409));
    }
    if (!isAppointmentTransitionAllowed(appointment.status, normalizedStatus)) {
        return throwError(new AppError('Bu randevu durumu için geçiş geçersiz.', 409));
    }

    const previousStatus = appointment.status;
    appointment.status = normalizedStatus;
    if (normalizedStatus === 'rejected' || normalizedStatus === 'cancelled') {
        appointment.statusReason = normalizedReason || undefined;
    } else {
        appointment.statusReason = undefined;
    }
    await appointment.save();

    if (previousStatus !== normalizedStatus && normalizedStatus === 'completed') {
        try {
            await createSettlementForCompletedAppointment(appointment);
        } catch (error) {
            console.warn('[BusinessSettlement] Completion record failed:', error.message);
        }
    }

    if (previousStatus !== normalizedStatus) {
        await recordBusinessAudit({
            businessId: appointment.businessId,
            actorId: input.user.id,
            action: 'APPOINTMENT_STATUS_CHANGED',
            targetId: appointment._id,
            metadata: {
                from: previousStatus,
                to: normalizedStatus,
                role: isBusiness ? 'business' : 'customer',
                hasReason: Boolean(normalizedReason)
            }
        });
    }

    // Notify the other side of the appointment.
    await createNotification({
        recipient: isBusiness ? appointment.customerId : appointment.businessId,
        sender: input.user.id,
        type: APPOINTMENT_NOTIFICATION_TYPE[normalizedStatus] || 'APPOINTMENT_UPDATE',
        appointment: appointment._id,
        route: isBusiness ? 'my_appointments' : 'business_dashboard'
    });

    respond({
        status: 'success',
        data: { appointment }
    },200);

    return response;
};
