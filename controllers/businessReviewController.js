import mongoose from 'mongoose';

import Appointment from '../models/Appointment.js';
import BusinessReview from '../models/BusinessReview.js';
import User from '../models/User.js';
import AppError from '../utils/appError.js';
import catchAsync from '../utils/catchAsync.js';

const refreshBusinessRating = async (businessId) => {
    const [summary] = await BusinessReview.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(businessId) } },
        {
            $group: {
                _id: '$businessId',
                ratingAverage: { $avg: '$rating' },
                ratingCount: { $sum: 1 }
            }
        }
    ]);
    await User.updateOne(
        { _id: businessId, userType: 'PROFESSIONAL' },
        {
            $set: {
                'businessProfile.ratingAverage': Number((summary?.ratingAverage || 0).toFixed(1)),
                'businessProfile.ratingCount': summary?.ratingCount || 0
            }
        }
    );
};

export const getBusinessReviews = catchAsync(async (req, res, next) => {
    const businessId = String(req.params.businessId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return next(new AppError('Geçersiz işletme kimliği.', 400));
    }
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);
    const [reviews, total, business] = await Promise.all([
        BusinessReview.find({ businessId })
            .populate('customerId', 'name username avatar')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        BusinessReview.countDocuments({ businessId }),
        User.findOne({ _id: businessId, userType: 'PROFESSIONAL' })
            .select('businessProfile.ratingAverage businessProfile.ratingCount')
            .lean()
    ]);
    if (!business) return next(new AppError('İşletme bulunamadı.', 404));

    res.status(200).json({
        status: 'success',
        results: reviews.length,
        data: {
            reviews,
            page,
            hasMore: page * limit < total,
            ratingAverage: business.businessProfile?.ratingAverage || 0,
            ratingCount: business.businessProfile?.ratingCount || total
        }
    });
});

export const upsertBusinessReview = catchAsync(async (req, res, next) => {
    const businessId = String(req.params.businessId || '').trim();
    const customerId = String(req.user.id);
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return next(new AppError('Geçersiz işletme kimliği.', 400));
    }
    if (businessId === customerId) {
        return next(new AppError('Kendi işletmenizi değerlendiremezsiniz.', 400));
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return next(new AppError('Puan 1 ile 5 arasında olmalıdır.', 400));
    }
    if (comment.length > 500) {
        return next(new AppError('Yorum en fazla 500 karakter olabilir.', 400));
    }

    const appointment = await Appointment.findOne({
        businessId,
        customerId,
        status: 'completed'
    }).sort({ date: -1 }).select('_id');
    if (!appointment) {
        return next(new AppError('Değerlendirme için tamamlanmış bir randevu gerekir.', 403));
    }

    const review = await BusinessReview.findOneAndUpdate(
        { businessId, customerId },
        {
            $set: {
                appointmentId: appointment._id,
                rating,
                comment: comment || undefined
            }
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).populate('customerId', 'name username avatar');
    await refreshBusinessRating(businessId);

    res.status(200).json({
        status: 'success',
        message: 'Değerlendirmeniz kaydedildi.',
        data: { review }
    });
});

export const deleteBusinessReview = catchAsync(async (req, res, next) => {
    const reviewId = String(req.params.reviewId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
        return next(new AppError('Geçersiz değerlendirme kimliği.', 400));
    }
    const review = await BusinessReview.findOneAndDelete({
        _id: reviewId,
        customerId: req.user.id
    });
    if (!review) return next(new AppError('Değerlendirme bulunamadı.', 404));
    await refreshBusinessRating(review.businessId);
    res.status(200).json({ status: 'success', message: 'Değerlendirme silindi.' });
});
