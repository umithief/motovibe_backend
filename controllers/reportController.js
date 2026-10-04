import Report from '../models/Report.js';
import Notification from '../models/Notification.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/appError.js';
import mongoose from 'mongoose';

// User Submission Endpoint
export const createReport = catchAsync(async (req, res, next) => {
    let { targetId, targetModel, reasonCategory, customNote, targetType, reason, description } = req.body;

    if (!targetModel && targetType) {
        targetModel = targetType.charAt(0).toUpperCase() + targetType.slice(1).toLowerCase();
    }
    reasonCategory = reasonCategory || reason;
    customNote = customNote || description || '';

    if (!targetId || !targetModel || !reasonCategory) {
        return next(new AppError('Lütfen rapor edilecek içeriği, modeli ve nedenini belirtin.', 400));
    }

    const validModels = ['User', 'Post', 'Route', 'Comment', 'HazardPin', 'Reel'];
    if (!validModels.includes(targetModel)) {
        return next(new AppError('Geçersiz içerik türü.', 400));
    }

    // Optional: Ensure the target actually exists dynamically
    const Model = mongoose.models[targetModel];
    if (Model) {
        const targetExists = await Model.findById(targetId);
        if (!targetExists) {
            return next(new AppError('Rapor edilecek içerik bulunamadı.', 404));
        }
    }

    // Prevent duplicates
    const existingReport = await Report.findOne({
        reporterId: req.user.id,
        targetId,
        status: { $in: ['PENDING', 'REVIEWING'] }
    });

    if (existingReport) {
        return next(new AppError('Bu içeriği zaten raporladınız, yöneticilerimiz inceliyor.', 400));
    }

    const report = await Report.create({
        reporterId: req.user.id,
        targetId,
        targetModel,
        reasonCategory,
        customNote
    });

    res.status(201).json({
        status: 'success',
        message: 'Raporunuz başarıyla alındı. Asfaltı temiz tuttuğunuz için teşekkürler!',
        data: { report }
    });
});

// Admin Fetch Reports
export const getAdminReports = catchAsync(async (req, res, next) => {
    const { status = 'PENDING', page = 1, limit = 20 } = req.query;
    
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

    res.status(200).json({
        status: 'success',
        results: reports.length,
        data: { reports }
    });
});

// Admin Resolve Endpoint
export const resolveReport = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { action, notifyUser, adminNote } = req.body;

    const report = await Report.findById(id);
    if (!report) {
        return next(new AppError('Rapor bulunamadı.', 404));
    }

    report.status = 'RESOLVED';
    report.adminActionTaken = action;
    report.resolvedBy = req.user.id;
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
            sender: req.user.id,
            type: 'REPORT_RESOLVED',
            text: 'Bildirdiğiniz içerik incelendi ve kurallarımız gereği kaldırıldı. Asfaltı temiz tuttuğunuz için teşekkürler!',
            metadata: { reportId: report._id }
        });
    }

    res.status(200).json({
        status: 'success',
        message: 'Rapor çözümlendi.',
        data: { report }
    });
});
