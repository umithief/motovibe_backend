import mongoose from 'mongoose';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/appError.js';
import User from "../modules/users/model.js";
import { hasActiveApexAccess } from '../utils/apexAccess.js';
import { verifyAccessToken } from "../modules/auth/service.js";

const extractBearerToken = (authorization) => {
    if (typeof authorization !== 'string') return null;
    const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
    return match?.[1] || null;
};

export const protect = catchAsync(async (req, res, next) => {
    let token;

    token = extractBearerToken(req.headers.authorization);

    if (!token) {
        console.warn('⚠️ [Auth Middleware] No token provided in headers');
        return next(new AppError('Giriş yapmanız gerekiyor.', 401));
    }

    const decoded = verifyAccessToken(token);
    const decodedId = decoded?.id?.toString?.() ?? '';

    // Prevent CastError -> 500 when old/invalid tokens contain malformed ids.
    if (!decodedId || !mongoose.Types.ObjectId.isValid(decodedId)) {
        console.warn('⚠️ [Auth Middleware] Invalid token payload id:', decoded?.id);
        return next(new AppError('Geçersiz token. Lütfen tekrar giriş yapın.', 401));
    }

    // PERFORMANCE FIX: Only select AUTH-essential fields
    // Heavy arrays (followers, following, savedPosts, garage) are NOT needed for auth
    // Controllers that need them should query separately
    const currentUser = await User.findById(decodedId)
        .select('+tokenVersion name email username avatar isAdmin rank isVerified bio primaryBike bikeModel verificationStatus isPro isPremium proExpiryDate blockedUsers')
        .lean();

    if (!currentUser) {
        console.error('❌ [Auth Middleware] User not found for token payload:', decoded);
        return next(
            new AppError('Bu tokena ait kullanıcı artık mevcut değil.', 401)
        );
    }

    if (!Number.isInteger(decoded.tokenVersion) || decoded.tokenVersion !== Number(currentUser.tokenVersion || 0)) {
        return next(new AppError('Oturumunuz gecersiz kilindi. Lutfen tekrar giris yapin.', 401));
    }

    // Attach user with id accessor for compatibility
    delete currentUser.tokenVersion;
    req.user = currentUser;
    req.user.id = currentUser._id.toString();
    req.user.isApex = hasActiveApexAccess(currentUser);
    next();
});

export const admin = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        return next(new AppError('Bu işlem için yetkiniz yok (Admin only).', 403));
    }
};

export const requireApex = (req, res, next) => {
    if (req.user?.isApex) {
        return next();
    }

    return next(new AppError('Bu ozellik icin APEX üyeliği gerekli.', 403));
};

export const checkUser = catchAsync(async (req, res, next) => {
    let token;
    token = extractBearerToken(req.headers.authorization);

    if (!token) {
        return next();
    }

    try {
        const decoded = verifyAccessToken(token);
        const decodedId = decoded?.id?.toString?.() ?? '';
        if (!mongoose.Types.ObjectId.isValid(decodedId)) return next();
        const currentUser = await User.findById(decodedId)
            .select('+tokenVersion name email username avatar isAdmin rank isVerified bio blockedUsers')
            .lean();
        if (currentUser && Number.isInteger(decoded.tokenVersion) && decoded.tokenVersion === Number(currentUser.tokenVersion || 0)) {
            delete currentUser.tokenVersion;
            req.user = currentUser;
            req.user.id = currentUser._id.toString();
        }
    } catch (err) {
        // Token invalid or expired, just ignore and treat as guest
    }
    next();
});
