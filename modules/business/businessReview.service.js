import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import mongoose from 'mongoose';

import Appointment from "../appointments/model.js";
import BusinessReview from "./model.js";
import User from "../users/model.js";
import AppError from "../../utils/appError.js";


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

export const getBusinessReviews = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const businessId = String(input.params.businessId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return throwError(new AppError('Geçersiz işletme kimliği.', 400));
    }
    const page = Math.max(parseInt(input.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(input.query.limit, 10) || 10, 1), 30);
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
    if (!business) return throwError(new AppError('İşletme bulunamadı.', 404));

    respond({
        status: 'success',
        results: reviews.length,
        data: {
            reviews,
            page,
            hasMore: page * limit < total,
            ratingAverage: business.businessProfile?.ratingAverage || 0,
            ratingCount: business.businessProfile?.ratingCount || total
        }
    },200);

    return response;
};

export const upsertBusinessReview = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const businessId = String(input.params.businessId || '').trim();
    const customerId = String(input.user.id);
    const rating = Number(input.body?.rating);
    const comment = String(input.body?.comment || '').trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return throwError(new AppError('Geçersiz işletme kimliği.', 400));
    }
    if (businessId === customerId) {
        return throwError(new AppError('Kendi işletmenizi değerlendiremezsiniz.', 400));
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return throwError(new AppError('Puan 1 ile 5 arasında olmalıdır.', 400));
    }
    if (comment.length > 500) {
        return throwError(new AppError('Yorum en fazla 500 karakter olabilir.', 400));
    }

    const appointment = await Appointment.findOne({
        businessId,
        customerId,
        status: 'completed'
    }).sort({ date: -1 }).select('_id');
    if (!appointment) {
        return throwError(new AppError('Değerlendirme için tamamlanmış bir randevu gerekir.', 403));
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

    respond({
        status: 'success',
        message: 'Değerlendirmeniz kaydedildi.',
        data: { review }
    },200);

    return response;
};

export const deleteBusinessReview = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const reviewId = String(input.params.reviewId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
        return throwError(new AppError('Geçersiz değerlendirme kimliği.', 400));
    }
    const review = await BusinessReview.findOneAndDelete({
        _id: reviewId,
        customerId: input.user.id
    });
    if (!review) return throwError(new AppError('Değerlendirme bulunamadı.', 404));
    await refreshBusinessRating(review.businessId);
    respond({ status: 'success', message: 'Değerlendirme silindi.' },200);

    return response;
};
