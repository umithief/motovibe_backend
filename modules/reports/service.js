import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import Report from "./model.js";
import Notification from "../notifications/model.js";

import AppError from "../../utils/appError.js";
import mongoose from 'mongoose';

// User Submission Endpoint
export const createReport = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    let { targetId, targetModel, reasonCategory, customNote, targetType, reason, description } = input.body;

    if (!targetModel && targetType) {
        targetModel = targetType.charAt(0).toUpperCase() + targetType.slice(1).toLowerCase();
    }
    reasonCategory = reasonCategory || reason;
    customNote = customNote || description || '';

    if (!targetId || !targetModel || !reasonCategory) {
        return throwError(new AppError('Lütfen rapor edilecek içeriği, modeli ve nedenini belirtin.', 400));
    }

    const validModels = ['User', 'Post', 'Route', 'Comment', 'HazardPin', 'Reel'];
    if (!validModels.includes(targetModel)) {
        return throwError(new AppError('Geçersiz içerik türü.', 400));
    }

    // Optional: Ensure the target actually exists dynamically
    const Model = mongoose.models[targetModel];
    if (Model) {
        const targetExists = await Model.findById(targetId);
        if (!targetExists) {
            return throwError(new AppError('Rapor edilecek içerik bulunamadı.', 404));
        }
    }

    // Prevent duplicates
    const existingReport = await Report.findOne({
        reporterId: input.user.id,
        targetId,
        status: { $in: ['PENDING', 'REVIEWING'] }
    });

    if (existingReport) {
        return throwError(new AppError('Bu içeriği zaten raporladınız, yöneticilerimiz inceliyor.', 400));
    }

    const report = await Report.create({
        reporterId: input.user.id,
        targetId,
        targetModel,
        reasonCategory,
        customNote
    });

    respond({
        status: 'success',
        message: 'Raporunuz başarıyla alındı. Asfaltı temiz tuttuğunuz için teşekkürler!',
        data: { report }
    },201);

    return response;
};

// Admin Fetch Reports
export const getAdminReports = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { status = 'PENDING', page = 1, limit = 20 } = input.query;

    // We fetch reports and use dynamic populate for the polymorphic 'targetId' based on 'targetModel'
    const query = Report.find({ status })
        .populate('reporterId', 'name username avatar email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

    const reports = await query;

    // Manual population for polymorphic relation since mongoose dynamic populate can be tricky if paths vary
    for (let report of reports) {
        if (mongoose.models[report.targetModel]) {
            await report.populate({
                path: 'targetId',
                model: report.targetModel
            });
        }
    }

    respond({
        status: 'success',
        results: reports.length,
        data: { reports }
    },200);

    return response;
};

// Admin Resolve Endpoint
export const resolveReport = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { id } = input.params;
    const { action, notifyUser, adminNote } = input.body;

    const report = await Report.findById(id);
    if (!report) {
        return throwError(new AppError('Rapor bulunamadı.', 404));
    }

    report.status = 'RESOLVED';
    report.adminActionTaken = action;
    report.resolvedBy = input.user.id;
    report.resolvedAt = Date.now();

    if (adminNote) {
        report.customNote = (report.customNote ? report.customNote + ' | ' : '') + `Admin Notu: ${adminNote}`;
    }

    // Execute actions based on targetModel (e.g. Delete Post)
    const Model = mongoose.models[report.targetModel];
    if (Model && action === 'DELETE_CONTENT') {
        await Model.findByIdAndDelete(report.targetId);
    } else if (Model && action === 'BAN_USER' && report.targetModel === 'User') {
        await Model.findByIdAndUpdate(report.targetId, { isActive: false }); // or similar logic
    }

    await report.save();

    // Feedback Loop
    if (notifyUser) {
        await Notification.create({
            recipient: report.reporterId,
            sender: input.user.id,
            type: 'REPORT_RESOLVED',
            text: 'Bildirdiğiniz içerik incelendi ve kurallarımız gereği kaldırıldı. Asfaltı temiz tuttuğunuz için teşekkürler!',
            metadata: { reportId: report._id }
        });
    }

    respond({
        status: 'success',
        message: 'Rapor çözümlendi.',
        data: { report }
    },200);

    return response;
};
