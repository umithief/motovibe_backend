import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import User from "./model.js";

import AppError from "../../utils/appError.js";
import { hasActiveApexAccess } from "../../utils/apexAccess.js";
import { PRO_OFFERS } from './service.js';

export const getProOffers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    respond({
        status: 'success',
        data: { offerings: PRO_OFFERS }
    },200);

    return response;
};

export const subscribeToPro = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    return throwError(new AppError(
        'Doğrudan PRO aktivasyonu kapalıdır. Satın alma App Store veya Google Play üzerinden doğrulanmalıdır.',
        503
    ));

    return response;
};

export const restoreProSubscription = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id).select('isPro isPremium proExpiryDate');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const now = new Date();
    const active = hasActiveApexAccess(user, now);
    if (!active && (user.isPro || user.isPremium)) {
        user.isPro = false;
        user.isPremium = false;
        await user.save({ validateBeforeSave: false });
    }

    respond({
        status: 'success',
        data: {
            isPro: active,
            proExpiryDate: user.proExpiryDate || null
        },
        message: active ? 'PRO üyeliği geri yuklendi.' : 'Aktif PRO üyeliği bulunamadı.'
    },200);

    return response;
};
