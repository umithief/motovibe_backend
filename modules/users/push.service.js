import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import User from "./model.js";

import AppError from "../../utils/appError.js";

export const registerPushToken = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const token = String(input.body?.token || '').trim();
    const platform = ['android', 'ios', 'web'].includes(input.body?.platform)
        ? input.body.platform
        : 'unknown';
    if (!token || token.length > 512) {
        return throwError(new AppError('Geçerli bir bildirim tokenı gönderilmelidir.', 400));
    }
    const user = await User.findById(input.user.id).select('pushTokens');
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    const tokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
    const existing = tokens.find((entry) => entry.token === token);
    if (existing) {
        existing.platform = platform;
        existing.updatedAt = new Date();
    } else {
        tokens.push({ token, platform, updatedAt: new Date() });
    }
    user.pushTokens = tokens
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 5);
    await user.save({ validateBeforeSave: false });
    respond({ status: 'success' },200);

    return response;
};

export const unregisterPushToken = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const token = String(input.body?.token || '').trim();
    if (!token) return throwError(new AppError('Bildirim tokenı zorunludur.', 400));
    await User.updateOne({ _id: input.user.id }, { $pull: { pushTokens: { token } } });
    respond({ status: 'success' },200);

    return response;
};
