import Appointment from '../models/Appointment.js';
import Notification from '../models/Notification.js';
import { createNotification } from './notificationController.js';
import { recordBusinessAudit } from '../services/businessAuditService.js';
import { createSettlementForCompletedAppointment } from '../services/businessSettlementService.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/appError.js';
import User from '../models/User.js';
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
const APPOINTMENT_NOTIFICATION_TYPE = Object.freeze({
    approved: 'APPOINTMENT_APPROVED',
    rejected: 'APPOINTMENT_REJECTED',
    inProgress: 'APPOINTMENT_IN_PROGRESS',
    completed: 'APPOINTMENT_COMPLETED',
    cancelled: 'APPOINTMENT_CANCELLED'
});

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
    const slot = workingHours.find((item) => item?.day === WEEKDAY_NAMES[date.getDay()]);
    if (!slot || slot.isClosed) return false;
    const open = minutesFromTime(slot.open);
    const close = minutesFromTime(slot.close);
    if (open === null || close === null || close <= open) return false;
    const start = date.getHours() * 60 + date.getMinutes();
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
export const getBusinessAppointments = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const requestedRole = String(req.query.role || '').trim().toLowerCase();
    if (requestedRole && !['business', 'customer'].includes(requestedRole)) {
        return next(new AppError('Randevu rolü geçersiz.', 400));
    }
    const requestedStatus = String(req.query.status || '').trim();
    if (requestedStatus && !ALLOWED_STATUSES.has(requestedStatus)) {
        return next(new AppError('Randevu durum filtresi geçersiz.', 400));
    }
    const role = requestedRole || (user.userType === 'PROFESSIONAL' ? 'business' : 'customer');
    if (role === 'business' && user.userType !== 'PROFESSIONAL') {
        return next(new AppError('İşletme randevuları için BİZ hesabı gerekir.', 403));
    }
    const ownershipFilter = role === 'business'
        ? { businessId: req.user.id }
        : { customerId: req.user.id };
    const filter = requestedStatus
        ? { ...ownershipFilter, status: requestedStatus }
        : ownershipFilter;

    let appointments = [];
    let totalAppointments = 0;

    if (role === 'business') {
        appointments = await Appointment.find(filter)
            .populate('customerId', 'name username avatar')
            .sort({ date: 1 })
            .skip(skip)
            .limit(limit);
        totalAppointments = await Appointment.countDocuments(filter);
    } else {
        appointments = await Appointment.find(filter)
            .populate('businessId', 'name username avatar userType businessProfile.businessName')
            .sort({ date: 1 })
            .skip(skip)
            .limit(limit);
        totalAppointments = await Appointment.countDocuments(filter);
    }

    const hasMore = skip + appointments.length < totalAppointments;

    res.status(200).json({
        status: 'success',
        results: appointments.length,
        data: { appointments, page, hasMore }
    });
});

// Book an appointment
export const bookAppointment = catchAsync(async (req, res, next) => {
    const { businessId, service, date, notes, catalogItemId, durationMin, attachmentUrl } = req.body;
    const normalizedBusinessId = String(businessId || '').trim();
    const requestedService = String(service || '').trim();
    const normalizedNotes = String(notes || '').trim();
    const normalizedAttachmentUrl = String(attachmentUrl || '').trim();

    if (!mongoose.Types.ObjectId.isValid(normalizedBusinessId)) {
        return next(new AppError('Geçersiz isletme kimligi.', 400));
    }
    if (normalizedBusinessId === String(req.user.id)) {
        return next(new AppError('Kendi işletmenizden randevu alamazsınız.', 400));
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() < Date.now() - 60000) {
        return next(new AppError('Randevu tarihi geçersiz.', 400));
    }
    const normalizedDuration = Number(durationMin ?? 60);
    if (!Number.isInteger(normalizedDuration) || normalizedDuration < 15 || normalizedDuration > 480 || normalizedDuration % 15 !== 0) {
        return next(new AppError('Randevu süresi 15-480 dakika arasında ve 15 dakikanın katı olmalı.', 400));
    }

    if (normalizedNotes.length > 500) {
        return next(new AppError('Not alani en fazla 500 karakter olabilir.', 400));
    }
    if (normalizedAttachmentUrl &&
        !normalizedAttachmentUrl.startsWith('/api/uploads/') &&
        !/^https?:\/\//i.test(normalizedAttachmentUrl)) {
        return next(new AppError('Randevu görsel adresi geçersiz.', 400));
    }

    const businessUser = await User.findById(normalizedBusinessId)
        .select('_id userType businessProfile.acceptsAppointments businessProfile.services businessProfile.catalogItems businessProfile.workingHours');
    if (!businessUser || businessUser.userType !== 'PROFESSIONAL') {
        return next(new AppError('Geçersiz isletme.', 404));
    }

    if (businessUser.businessProfile?.acceptsAppointments === false) {
        return next(new AppError('Bu işletme şu anda randevu kabul etmiyor.', 403));
    }
    const serviceResolution = resolveAppointmentService({
        requestedService,
        catalogItemId,
        catalogItems: businessUser.businessProfile?.catalogItems || [],
        services: businessUser.businessProfile?.services || []
    });
    if (serviceResolution.error) {
        return next(new AppError(serviceResolution.error, 400));
    }
    const resolvedService = serviceResolution.service;
    if (!appointmentFitsWorkingHours(businessUser.businessProfile?.workingHours, parsedDate, normalizedDuration)) {
        return next(new AppError('Seçilen saat işletmenin çalışma saatleri dışında.', 400));
    }
    const conflictEnd = new Date(parsedDate.getTime() + normalizedDuration * 60000);
    const conflicts = await Appointment.find({
        businessId: normalizedBusinessId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        date: { $lt: conflictEnd }
    }).select('date durationMin');
    if (conflicts.some((entry) => new Date(entry.date).getTime() + Number(entry.durationMin || 60) * 60000 > parsedDate.getTime())) {
        return next(new AppError('Bu saat artık dolu. Lütfen başka bir saat seçin.', 409));
    }
    const appointment = await Appointment.create({
        businessId: normalizedBusinessId,
        customerId: req.user.id,
        service: resolvedService,
        date: parsedDate,
        durationMin: normalizedDuration,
        catalogItemId: catalogItemId || undefined,
        notes: normalizedNotes || undefined,
        attachmentUrl: normalizedAttachmentUrl || undefined
    });

    // Notify business
    await createNotification({
        recipient: normalizedBusinessId,
        sender: req.user.id,
        type: 'APPOINTMENT_REQUEST',
        appointment: appointment._id
    });

    res.status(201).json({
        status: 'success',
        data: { appointment }
    });
});

export const getAppointmentAvailability = catchAsync(async (req, res, next) => {
    const businessId = String(req.query.businessId || '').trim();
    const date = new Date(String(req.query.date || ''));
    const durationMin = Number(req.query.durationMin || 60);
    if (!mongoose.Types.ObjectId.isValid(businessId) || Number.isNaN(date.getTime())) {
        return next(new AppError('İşletme veya tarih geçersiz.', 400));
    }
    if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 480 || durationMin % 15 !== 0) {
        return next(new AppError('Randevu süresi geçersiz.', 400));
    }
    const business = await User.findById(businessId).select('userType businessProfile.acceptsAppointments businessProfile.workingHours');
    if (!business || business.userType !== 'PROFESSIONAL' || business.businessProfile?.acceptsAppointments === false) {
        return res.status(200).json({ status: 'success', data: { slots: [] } });
    }
    const slot = (business.businessProfile?.workingHours || []).find((item) => item?.day === WEEKDAY_NAMES[date.getDay()]);
    const open = minutesFromTime(slot?.open);
    const close = minutesFromTime(slot?.close);
    if (!slot || slot.isClosed || open === null || close === null || close <= open) {
        return res.status(200).json({ status: 'success', data: { slots: [] } });
    }
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const appointments = await Appointment.find({
        businessId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        date: { $gte: dayStart, $lt: dayEnd }
    }).select('date durationMin');
    const slots = [];
    for (let minute = open; minute + durationMin <= close; minute += 30) {
        const start = new Date(dayStart.getTime() + minute * 60000);
        if (start.getTime() < Date.now()) continue;
        const end = start.getTime() + durationMin * 60000;
        const occupied = appointments.some((entry) => {
            const entryStart = new Date(entry.date).getTime();
            const entryEnd = entryStart + Number(entry.durationMin || 60) * 60000;
            return entryStart < end && entryEnd > start.getTime();
        });
        if (!occupied) slots.push(start.toISOString());
    }
    res.status(200).json({ status: 'success', data: { slots } });
});

// Update appointment status
export const updateAppointmentStatus = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { status, reason } = req.body;
    const normalizedStatus = String(status || '').trim();
    const normalizedReason = String(reason || '').trim();

    if (!mongoose.Types.ObjectId.isValid(String(id || '').trim())) {
        return next(new AppError('Geçersiz randevu kimligi.', 400));
    }

    if (!ALLOWED_STATUSES.has(normalizedStatus)) {
        return next(new AppError('Geçersiz randevu durumu.', 400));
    }
    if (normalizedReason.length > 300) {
        return next(new AppError('Randevu açıklaması en fazla 300 karakter olabilir.', 400));
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
        return next(new AppError('Randevu bulunamadı.', 404));
    }

    const isBusiness = appointment.businessId.toString() === req.user.id;
    const isCustomer = appointment.customerId.toString() === req.user.id;
    const businessStatuses = new Set(['approved', 'rejected', 'inProgress', 'completed', 'cancelled']);

    if (!isBusiness && !isCustomer) {
        return next(new AppError('Bu islem icin yetkiniz yok.', 403));
    }
    if (isCustomer && normalizedStatus !== 'cancelled') {
        return next(new AppError('Musteri sadece randevuyu iptal edebilir.', 403));
    }
    if (isBusiness && !businessStatuses.has(normalizedStatus)) {
        return next(new AppError('Isletme bu duruma gecis yapamaz.', 400));
    }
    if (isBusiness && normalizedStatus === 'rejected' && normalizedReason.length < 3) {
        return next(new AppError('Reddetme nedeni en az 3 karakter olmalıdır.', 400));
    }
    if (['completed', 'rejected', 'cancelled'].includes(appointment.status) && normalizedStatus !== appointment.status) {
        return next(new AppError('Sonuçlanmış randevu yeniden açılamaz.', 409));
    }
    if (!isAppointmentTransitionAllowed(appointment.status, normalizedStatus)) {
        return next(new AppError('Bu randevu durumu için geçiş geçersiz.', 409));
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
            actorId: req.user.id,
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
        sender: req.user.id,
        type: APPOINTMENT_NOTIFICATION_TYPE[normalizedStatus] || 'APPOINTMENT_UPDATE',
        appointment: appointment._id,
        route: isBusiness ? 'my_appointments' : 'business_dashboard'
    });

    res.status(200).json({
        status: 'success',
        data: { appointment }
    });
});

