import mongoose from 'mongoose';
import crypto from 'crypto';
import { defaultAchievements } from '../data/achievements.js';
import User from '../models/User.js';
import Post from '../models/Post.js';
import Reel from '../models/Reel.js';
import Route from '../models/Route.js';
import Appointment from '../models/Appointment.js';
import Achievement from '../models/Achievement.js';
import Comment from '../models/Comment.js';
import ReelComment from '../models/ReelComment.js';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import PackLoungeMessage from '../models/PackLoungeMessage.js';
import PackPost from '../models/PackPost.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/appError.js';
import { createNotification } from './notificationController.js';
import { recordBusinessAudit } from '../services/businessAuditService.js';
import { recalculatePacksForUser, refreshPackGlobalRanks } from '../services/packGarageService.js';
import bcrypt from 'bcryptjs';
import { isReservedUsername } from '../utils/reservedUsernames.js';
import { escapeRegex } from '../utils/tagUtils.js';
import { hasActiveApexAccess } from '../utils/apexAccess.js';
import { issueSessionTokens } from '../services/sessionTokenService.js';
import { evaluateAndUnlock, ensureDefaultAchievements, calculateRankAndLevel, incrementMetric, setMaxMetric, recordVisitedCity } from '../services/achievementEngine.js';
import redis from '../config/redis.js';
import { sendSMS } from '../services/smsService.js';
import PhoneOtp from '../models/PhoneOtp.js';
import { getJwtSecret } from '../config/env.js';
import { disconnectUserSessions } from '../socket.js';

const createSendToken = async (user, statusCode, res) => {
    const { accessToken, refreshToken } = await issueSessionTokens(user);

    // Remove password from output
    user.password = undefined;
    user.tokenVersion = undefined;
    user.refreshSessions = undefined;
    user.resetPasswordOTPHash = undefined;
    user.resetPasswordNonce = undefined;
    user.resetPasswordAttempts = undefined;
    user.resetPasswordExpires = undefined;

    res.status(statusCode).json({
        status: 'success',
        token: accessToken,
        refreshToken,
        data: {
            token: accessToken,
            refreshToken,
            user
        }
    });
};

const BUSINESS_CATEGORIES = ['SERVICE', 'STORE', 'CAFE', 'RENTAL', 'INFLUENCER'];
const BUSINESS_WEEKDAYS = new Set([
    'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'
]);
const BUSINESS_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidBusinessCoordinates(value) {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude) &&
        longitude >= -180 && longitude <= 180 &&
        latitude >= -90 && latitude <= 90;
}

export function normalizeBusinessWorkingHours(value) {
    if (!Array.isArray(value)) {
        return { error: 'Çalışma saatleri dizi formatında olmalıdır.' };
    }
    if (value.length > 7) {
        return { error: 'En fazla 7 günlük çalışma saati tanımlanabilir.' };
    }
    const seen = new Set();
    const normalized = [];
    for (const raw of value) {
        const day = String(raw?.day || '').trim();
        const isClosed = raw?.isClosed === true;
        const open = String(raw?.open || '').trim();
        const close = String(raw?.close || '').trim();
        if (!BUSINESS_WEEKDAYS.has(day) || seen.has(day)) {
            return { error: 'Çalışma günü geçersiz veya yinelenmiş.' };
        }
        if (!isClosed) {
            if (!BUSINESS_TIME_PATTERN.test(open) || !BUSINESS_TIME_PATTERN.test(close)) {
                return { error: `${day} için çalışma saati HH:mm formatında olmalıdır.` };
            }
            const [openHour, openMinute] = open.split(':').map(Number);
            const [closeHour, closeMinute] = close.split(':').map(Number);
            if (openHour * 60 + openMinute >= closeHour * 60 + closeMinute) {
                return { error: `${day} kapanış saati açılıştan sonra olmalıdır.` };
            }
        }
        seen.add(day);
        normalized.push({
            day,
            open: isClosed ? (open || '09:00') : open,
            close: isClosed ? (close || '18:00') : close,
            isClosed
        });
    }
    return { value: normalized };
}

export function isValidTurkishTaxIdentifier(rawValue) {
    const value = String(rawValue || '').trim();
    return /^\d{10}$/.test(value) || /^\d{11}$/.test(value);
}

function maskTaxIdentifier(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return null;
    return `${'*'.repeat(Math.max(value.length - 2, 0))}${value.slice(-2)}`;
}

export function normalizeBusinessServices(services) {
    if (!Array.isArray(services)) return [];
    return [...new Set(
        services
            .map((service) => String(service || '').trim())
            .filter((service) => service.length > 0 && service.length <= 60)
    )].slice(0, 40);
}

export function buildBusinessCatalogItemInput(payload, { preserveId = false } = {}) {
    if (!payload || typeof payload !== 'object') {
        return { error: 'Ürün bilgileri geçersiz.' };
    }

    const name = String(payload.name || '').trim();
    if (!name || name.length > 80) {
        return { error: 'Ürün adı 1 ile 80 karakter arasında olmalıdır.' };
    }

    const categoryRaw = String(payload.category || '').trim();
    if (categoryRaw.length > 40) {
        return { error: 'Kategori en fazla 40 karakter olabilir.' };
    }

    const price = Number(payload.price);
    if (!Number.isFinite(price) || price < 0) {
        return { error: 'Fiyat 0 veya daha büyük bir sayı olmalıdır.' };
    }

    let discountPrice;
    if (payload.discountPrice !== undefined && payload.discountPrice !== null && payload.discountPrice !== '') {
        const parsedDiscount = Number(payload.discountPrice);
        if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0 || parsedDiscount >= price) {
            return { error: 'İndirimli fiyat normal fiyattan küçük ve 0 veya daha büyük olmalıdır.' };
        }
        discountPrice = parsedDiscount;
    }

    const durationMin = Number(payload.durationMin ?? 60);
    if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 480 || durationMin % 15 !== 0) {
        return { error: 'Hizmet süresi 15-480 dakika arasında ve 15 dakikanın katı olmalıdır.' };
    }

    const apexBonusRaw = Number(payload.apexBonus ?? 0);
    if (!Number.isFinite(apexBonusRaw) || apexBonusRaw < 0 || !Number.isInteger(apexBonusRaw)) {
        return { error: 'Apex bonus 0 veya daha büyük tam sayı olmalıdır.' };
    }

    const stockRaw = Number(payload.stock ?? 0);
    if (!Number.isFinite(stockRaw) || stockRaw < 0 || !Number.isInteger(stockRaw)) {
        return { error: 'Stok 0 veya daha büyük tam sayı olmalıdır.' };
    }

    const imageUrl = String(payload.imageUrl || '').trim();
    if (imageUrl.length > 400) {
        return { error: 'Görsel adresi en fazla 400 karakter olabilir.' };
    }
    if (imageUrl) {
        const isMotoVibeUpload = imageUrl.startsWith('/api/uploads/');
        let isRemoteImage = false;
        try {
            const parsedUrl = new URL(imageUrl);
            isRemoteImage = parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:';
        } catch (_) {
            // Local MotoVibe media URLs are intentionally relative.
        }
        if (!isMotoVibeUpload && !isRemoteImage) {
            return { error: 'Görsel adresi https/http veya /api/uploads/ ile başlamalıdır.' };
        }
    }

    const description = String(payload.description || '').trim();
    if (description.length > 280) {
        return { error: 'Ürün açıklaması en fazla 280 karakter olabilir.' };
    }

    const item = {
        name,
        category: categoryRaw || 'Diger',
        price,
        discountPrice,
        durationMin,
        apexBonus: apexBonusRaw,
        stock: stockRaw,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true
    };

    if (preserveId && payload._id && mongoose.Types.ObjectId.isValid(String(payload._id))) {
        item._id = new mongoose.Types.ObjectId(String(payload._id));
    }

    return { value: item };
}

function normalizeBusinessCatalogItems(items) {
    if (!Array.isArray(items)) return { error: 'Katalog listesi dizi formatında olmalıdır.' };
    if (items.length > 120) return { error: 'Katalog en fazla 120 ürün içerebilir.' };

    const normalized = [];
    for (let index = 0; index < items.length; index += 1) {
        const parsed = buildBusinessCatalogItemInput(items[index], { preserveId: true });
        if (parsed.error) {
            return { error: `Katalogdaki ${index + 1}. ürün: ${parsed.error}` };
        }
        normalized.push(parsed.value);
    }
    return { value: normalized };
}

export function sanitizeBusinessFlashOffers(rawOffers) {
    if (!Array.isArray(rawOffers)) return [];

    const now = Date.now();
    const sanitized = [];

    for (const raw of rawOffers.slice(0, 30)) {
        if (!raw || typeof raw !== 'object') continue;

        const offerId = String(raw.offerId || '').trim().slice(0, 64);
        if (!offerId) continue;

        const title = String(raw.title || '').trim().slice(0, 80);
        if (!title) continue;

        const description = String(raw.description || '').trim().slice(0, 220);
        const discountRateRaw = Number(raw.discountRate);
        const discountRate = Number.isFinite(discountRateRaw)
            ? Math.max(0, Math.min(95, Math.round(discountRateRaw)))
            : 0;

        const targetRadiusRaw = Number(raw.targetRadiusKm);
        const targetRadiusKm = Number.isFinite(targetRadiusRaw)
            ? Math.max(1, Math.min(300, Math.round(targetRadiusRaw)))
            : 20;

        const parsedValidUntil = new Date(raw.validUntil);
        const validUntil = Number.isNaN(parsedValidUntil.getTime())
            ? new Date(now + (60 * 60 * 1000))
            : parsedValidUntil;

        const parsedCreatedAt = new Date(raw.createdAt);
        const createdAt = Number.isNaN(parsedCreatedAt.getTime())
            ? new Date(now)
            : parsedCreatedAt;

        const isActive = raw.isActive !== false && validUntil.getTime() > now;

        sanitized.push({
            offerId,
            title,
            description: description || undefined,
            discountRate,
            targetRadiusKm,
            validUntil,
            isActive,
            createdAt
        });
    }

    sanitized.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sanitized.slice(0, 20);
}

export function businessProfileForPublic(rawProfile) {
    if (!rawProfile) return rawProfile;
    const profile = rawProfile.toObject ? rawProfile.toObject() : rawProfile;
    const {
        taxId,
        iyzicoSubMerchantKey,
        flashOffers,
        ...publicProfile
    } = profile;
    return {
        ...publicProfile,
        flashOffers: sanitizeBusinessFlashOffers(flashOffers || [])
            .filter((offer) => offer.isActive)
    };
}

export function buildBusinessFlashOfferInput(payload) {
    const title = String(payload?.title || '').trim();
    const description = String(payload?.description || '').trim();
    const discountRateRaw = Number(payload?.discountRate);
    const durationMinutesRaw = Number(payload?.durationMinutes);
    const targetRadiusRaw = Number(payload?.targetRadiusKm);

    if (!title) {
        return { error: 'Kampanya basligi zorunludur.' };
    }
    if (title.length > 80) {
        return { error: 'Kampanya basligi en fazla 80 karakter olabilir.' };
    }
    if (description.length > 220) {
        return { error: 'Kampanya aciklamasi en fazla 220 karakter olabilir.' };
    }
    if (!Number.isFinite(discountRateRaw) || discountRateRaw < 1 || discountRateRaw > 95) {
        return { error: 'Indirim orani 1 ile 95 arasinda olmalidir.' };
    }
    if (!Number.isFinite(durationMinutesRaw) || durationMinutesRaw < 10 || durationMinutesRaw > 1440) {
        return { error: 'Kampanya suresi 10 ile 1440 dakika arasinda olmalidir.' };
    }
    if (!Number.isFinite(targetRadiusRaw) || targetRadiusRaw < 1 || targetRadiusRaw > 300) {
        return { error: 'Hedef yaricapi 1 ile 300 km arasinda olmalidir.' };
    }

    const now = Date.now();
    const validUntil = new Date(now + Math.round(durationMinutesRaw) * 60 * 1000);

    return {
        value: {
            offerId: new mongoose.Types.ObjectId().toString(),
            title,
            description: description || undefined,
            discountRate: Math.round(discountRateRaw),
            targetRadiusKm: Math.round(targetRadiusRaw),
            validUntil,
            isActive: true,
            createdAt: new Date(now)
        }
    };
}

export function normalizeProfessionalStatusForResponse(user) {
    if (user?.userType !== 'PROFESSIONAL') {
        user.activeProfileMode = 'PERSONAL';
    } else if (!user.activeProfileMode) {
        user.activeProfileMode = 'PROFESSIONAL';
    }

    return user;
}

function buildBusinessUserPayload(user) {
    return {
        _id: user._id,
        id: user.id || user._id,
        userType: user.userType,
        activeProfileMode: user.activeProfileMode || (user.userType === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'PERSONAL'),
        isPro: user.isPro,
        isVerified: user.isVerified,
        verificationStatus: user.verificationStatus,
        businessProfile: businessProfileForPublic(user.businessProfile)
    };
}

export function userLookupQuery(idOrUsername) {
    const base = { isDeleted: { $ne: true } };
    if (mongoose.isValidObjectId(idOrUsername)) {
        return { _id: idOrUsername, ...base };
    }
    return { username: String(idOrUsername || '').toLowerCase().trim(), ...base };
}

export function resolveViewerAccess(user, req) {
    const viewerId = req.user?.id ? String(req.user.id) : null;
    const userId = user._id.toString();
    const isMe = !!(viewerId && viewerId === userId);
    const viewerBlocked = (req.user?.blockedUsers || []).some((id) => id.toString() === userId);
    const targetBlocked = (user.blockedUsers || []).some((id) => viewerId && id.toString() === viewerId);
    const blocked = !!(!isMe && viewerId && (viewerBlocked || targetBlocked));
    const followersIds = (user.followers || []).map((id) => id.toString());
    const followingIds = (user.following || []).map((id) => id.toString());
    const isFollowing = viewerId ? followersIds.includes(viewerId) : false;
    const isPrivate = user.privacy?.isPrivate === true;
    const isLocked = isPrivate && !isMe && !isFollowing;
    const hideLocation = user.privacy?.hideLocation === true;
    return {
        viewerId,
        isMe,
        blocked,
        isFollowing,
        isPrivate,
        isLocked,
        hideLocation,
        followersIds,
        followingIds
    };
}

function stripGarageVerificationImages(garage) {
    if (!Array.isArray(garage)) return garage || [];
    return garage.map((bike) => {
        if (!bike || typeof bike !== 'object') return bike;
        const clone = { ...bike };
        delete clone.verificationImage;
        return clone;
    });
}

export function stripPublicUserFields(userObj, { hideLocation = false } = {}) {
    delete userObj.email;
    delete userObj.phone;
    delete userObj.emergencyPhone;
    delete userObj.emergencyContacts;
    delete userObj.lastCoordinates;
    delete userObj.coordinates;
    delete userObj.verificationImage;
    delete userObj.spotifyRefreshToken;
    delete userObj.cart;
    delete userObj.blockedUsers;
    delete userObj.isAdmin;
    delete userObj.revenueCatId;
    delete userObj.expenses;
    delete userObj.password;
    delete userObj.interestVector;
    userObj.garage = stripGarageVerificationImages(userObj.garage);
    if (hideLocation) {
        delete userObj.address;
        delete userObj.location;
        if (userObj.businessProfile && typeof userObj.businessProfile === 'object') {
            delete userObj.businessProfile.address;
        }
    }
    return userObj;
}

// --- AUTH CONTROLLERS ---

export const registerUser = catchAsync(async (req, res, next) => {
    const { name, email, password, username, bikeModel } = req.body;

    if ([name, email, password].some((value) => typeof value !== 'string' || !value.trim())) {
        return next(new AppError('Lütfen isim, e-posta ve şifre girin.', 400));
    }
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const requestedUsername = typeof username === 'string' && username.trim()
        ? username.trim().toLowerCase()
        : normalizedEmail
            .split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 20);
    const normalizedUsername = requestedUsername;
    if (normalizedName.length < 2 || normalizedName.length > 80) {
        return next(new AppError('Isim 2-80 karakter arasinda olmalidir.', 422));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
        return next(new AppError('Gecerli bir e-posta adresi girin.', 422));
    }
    if (password.length < 8 || password.length > 128) {
        return next(new AppError('Sifre 8-128 karakter arasinda olmalidir.', 422));
    }
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername) || isReservedUsername(normalizedUsername)) {
        return next(new AppError('Kullanici adi 3-20 karakter olmali ve yalnizca harf, rakam veya alt cizgi icermelidir.', 422));
    }

    const userExists = await User.exists({
        $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });
    if (userExists) {
        return next(new AppError('E-posta veya kullanici adi zaten kullanimda.', 409));
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Asfalt Kıdemi - Check if among first 1000 users
    let isFounder = false;
    try {
        const userCount = await User.countDocuments();
        isFounder = userCount < 1000;
    } catch (countErr) {
        console.error('[AUTH] countDocuments error:', countErr);
    }

    const newUser = await User.create({
        name: normalizedName,
        email: normalizedEmail,
        username: normalizedUsername,
        password: hashedPassword,
        bikeModel,
        isFounder,
        isPro: false,
        isPremium: false,
        isAdmin: false
    });

    await createSendToken(newUser, 201, res);
});

export const getMe = catchAsync(async (req, res, next) => {
    // PERFORMANCE FIX: Two parallel queries — light user data + counts via aggregation
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const [user, counts, posts, totalPosts] = await Promise.all([
        User.findById(req.user.id)
            .select('-password -blockedUsers -interestVector -spotifyRefreshToken -cart -savedPosts -savedRoutes')
            .lean(),
        User.aggregate([
            { $match: { _id: userId } },
            {
                $project: {
                    followersCount: { $size: { $ifNull: ['$followers', []] } },
                    followingCount: { $size: { $ifNull: ['$following', []] } },
                    savedPostsCount: { $size: { $ifNull: ['$savedPosts', []] } },
                    savedRoutesCount: { $size: { $ifNull: ['$savedRoutes', []] } },
                    followingIds: { $ifNull: ['$following', []] },
                    followersIds: { $ifNull: ['$followers', []] }
                }
            }
        ]),
        mongoose.model('SocialPost').find({ user: userId })
            .select('caption content images media likeCount commentCount createdAt tags')
            .sort({ createdAt: -1 })
            .limit(15)
            .lean(),
        mongoose.model('SocialPost').countDocuments({ user: userId })
    ]);

    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı', 404));
    }

    // Merge counts into user object
    const countData = counts[0] || {};
    user.followers = countData.followersCount || 0;
    user.following = countData.followingCount || 0;
    user.followersIds = (countData.followersIds || []).map(id => id.toString());
    user.followingIds = (countData.followingIds || []).map(id => id.toString());
    user.savedPostsCount = countData.savedPostsCount || 0;
    user.savedRoutesCount = countData.savedRoutesCount || 0;

    user.postsCount = totalPosts;
    user.posts = posts;
    user.totalRides = totalPosts;

    const unlockedIds = Array.isArray(user.unlockedAchievements) ? user.unlockedAchievements : [];
    let formattedBadges = [];
    if (unlockedIds.length > 0) {
        const badges = await mongoose.model('Achievement').find({ _id: { $in: unlockedIds } })
            .select('_id title description category badgeType metric requiredValue unit slug')
            .lean();
        formattedBadges = badges.map(ach => ({
            id: ach._id.toString(),
            _id: ach._id.toString(),
            title: ach.title,
            description: ach.description,
            category: ach.category,
            badgeType: ach.badgeType,
            metric: ach.metric,
            requiredValue: ach.requiredValue,
            unit: ach.unit || '',
            slug: ach.slug,
            isUnlocked: true,
            progress: 100
        }));
    }
    user.trophyBadges = formattedBadges;
    user.achievements = formattedBadges;

    normalizeProfessionalStatusForResponse(user);

    res.status(200).json({
        status: 'success',
        data: {
            user
        }
    });
});

export const loginUser = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return next(new AppError('Lütfen e-posta ve şifre girin.', 400));
    }

    const selectFields = '+password +tokenVersion name username email avatar coverImage bio phone address location garage totalKm topSpeed isAdmin isVerified rank points primaryBike bikeModel verificationStatus joinDate isFounder onboardingComplete createdAt isPro isPremium proExpiryDate preferences ridingPace emergencyPhone userType activeProfileMode businessProfile bioBlocks revenueCatId isDeleted';
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select(selectFields);

    if (!user) {
        return next(new AppError('Hatalı e-posta veya şifre.', 401));
    }

    if (user.isDeleted) {
        return next(new AppError('Bu hesap kapatılmıştır.', 403));
    }

    if (!(await bcrypt.compare(password, user.password))) {
        return next(new AppError('Hatalı e-posta veya şifre.', 401));
    }

    await createSendToken(user, 200, res);
});

// --- SOCIAL CONTROLLERS ---

export const toggleFollow = catchAsync(async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new AppError('Geçersiz Kullanıcı ID.', 400));
    }

    if (req.user.id === req.params.id) {
        return next(new AppError('Kendinizi takip edemezsiniz.', 400));
    }

    const { id: targetUserId } = req.params;
    const currentUserId = req.user.id;

    const [currentUser, targetUser] = await Promise.all([
        User.findById(currentUserId),
        User.findById(targetUserId)
    ]);

    if (!targetUser || !currentUser) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    // Engel kontrolü
    const isTargetBlockedByMe = (currentUser.blockedUsers || []).some(b => b.toString() === targetUserId.toString());
    const amIBlockedByTarget = (targetUser.blockedUsers || []).some(b => b.toString() === currentUserId.toString());
    if (isTargetBlockedByMe || amIBlockedByTarget) {
        return next(new AppError('Bu kullanıcıyla takipleşemezsiniz.', 403));
    }

    const isCurrentlyFollowing = (currentUser.following || []).some(id => id.toString() === targetUserId.toString());

    let requestedAction = typeof req.body?.action === 'string'
        ? req.body.action.trim().toLowerCase()
        : null;
    if (!requestedAction && req.method === 'DELETE') {
        requestedAction = 'unfollow';
    }
    if (requestedAction !== 'follow' && requestedAction !== 'unfollow') {
        return next(new AppError('Takip işlemi için action follow veya unfollow olmalıdır.', 400));
    }
    const shouldUnfollow = requestedAction === 'unfollow';

    if (shouldUnfollow) {
        if (isCurrentlyFollowing) {
            await Promise.all([
                User.findByIdAndUpdate(currentUserId, { $pull: { following: targetUserId } }),
                User.findByIdAndUpdate(targetUserId, { $pull: { followers: currentUserId } })
            ]);

            evaluateAndUnlock(currentUserId).catch(err => console.error(err));
            evaluateAndUnlock(targetUserId).catch(err => console.error(err));
        }

        const currentTargetFollowers = Math.max(0, (targetUser.followers?.length || 0) - (isCurrentlyFollowing ? 1 : 0));
        const currentUserFollowing = Math.max(0, (currentUser.following?.length || 0) - (isCurrentlyFollowing ? 1 : 0));

        return res.status(200).json({
            status: 'success',
            message: 'Takipten çıkıldı.',
            data: {
                isFollowing: false,
                followersCount: currentTargetFollowers,
                followingCount: currentUserFollowing
            }
        });
    } else {
        if (!isCurrentlyFollowing) {
            await Promise.all([
                User.findByIdAndUpdate(currentUserId, { $addToSet: { following: targetUserId } }),
                User.findByIdAndUpdate(targetUserId, { $addToSet: { followers: currentUserId } })
            ]);

            await createNotification({
                recipient: targetUserId,
                sender: currentUserId,
                type: 'FOLLOW'
            });

            evaluateAndUnlock(currentUserId).catch(err => console.error(err));
            evaluateAndUnlock(targetUserId).catch(err => console.error(err));
        }

        const currentTargetFollowers = (targetUser.followers?.length || 0) + (isCurrentlyFollowing ? 0 : 1);
        const currentUserFollowing = (currentUser.following?.length || 0) + (isCurrentlyFollowing ? 0 : 1);

        return res.status(200).json({
            status: 'success',
            message: 'Takip edildi.',
            data: {
                isFollowing: true,
                followersCount: currentTargetFollowers,
                followingCount: currentUserFollowing
            }
        });
    }
});

export const getProfile = catchAsync(async (req, res, next) => {
    const user = await User.findOne(userLookupQuery(req.params.id))
        .select('-password -interestVector -spotifyRefreshToken -cart -savedPosts -savedRoutes')
        .lean();

    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, req);
    if (access.blocked) {
        return next(new AppError('Bu kullanıcıya erişilemiyor.', 403));
    }

    const { isMe, isFollowing, isPrivate, isLocked, hideLocation, followersIds, followingIds } = access;
    const followersCount = followersIds.length;
    const followingCount = followingIds.length;

    let posts = [];
    let totalPosts = 0;

    if (!isLocked) {
        const [fetchedPosts, count] = await Promise.all([
            Post.find({ user: user._id, isDeleted: { $ne: true } })
                .sort({ createdAt: -1 })
                .limit(15)
                .select('caption content images media likeCount commentCount createdAt tags')
                .lean(),
            Post.countDocuments({ user: user._id, isDeleted: { $ne: true } })
        ]);
        posts = fetchedPosts;
        totalPosts = count;
    }

    const userObj = { ...user };
    userObj.businessProfile = businessProfileForPublic(user.businessProfile);
    userObj.followers = followersCount;
    userObj.following = followingCount;
    userObj.isFollowing = isFollowing;
    userObj.isPrivate = isPrivate;
    userObj.isLocked = isLocked;
    userObj.hideLocation = hideLocation;
    userObj.posts = posts;
    userObj.postsCount = totalPosts;
    userObj.totalRides = totalPosts;

    if (isMe) {
        userObj.followersIds = followersIds;
        userObj.followingIds = followingIds;
    } else {
        userObj.followersIds = [];
        userObj.followingIds = [];
    }

    if (isLocked) {
        userObj.garage = [];
        userObj.bioBlocks = [];
        userObj.totalKm = 0;
        userObj.topSpeed = 0;
    }

    if (!isMe) {
        stripPublicUserFields(userObj, { hideLocation });
    } else {
        delete userObj.blockedUsers;
        delete userObj.password;
    }

    const unlockedIds = Array.isArray(user.unlockedAchievements) ? user.unlockedAchievements : [];
    let formattedBadges = [];
    if (unlockedIds.length > 0) {
        const badges = await mongoose.model('Achievement').find({ _id: { $in: unlockedIds } })
            .select('_id title description category badgeType metric requiredValue unit slug')
            .lean();
        formattedBadges = badges.map(ach => ({
            id: ach._id.toString(),
            _id: ach._id.toString(),
            title: ach.title,
            description: ach.description,
            category: ach.category,
            badgeType: ach.badgeType,
            metric: ach.metric,
            requiredValue: ach.requiredValue,
            unit: ach.unit || '',
            slug: ach.slug,
            isUnlocked: true,
            progress: 100
        }));
    }
    userObj.trophyBadges = formattedBadges;
    userObj.achievements = formattedBadges;

    normalizeProfessionalStatusForResponse(userObj);

    res.status(200).json({
        status: 'success',
        data: {
            user: userObj,
            isFollowing,
            isLocked
        }
    });
});

// --- DEDICATED FOLLOWERS/FOLLOWING ENDPOINTS (Lazy-loaded, only when user clicks) ---

function parseFollowListPaging(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    return { page, limit, skip: (page - 1) * limit };
}

export const getFollowersList = catchAsync(async (req, res, next) => {
    const { page, limit, skip } = parseFollowListPaging(req.query);

    const user = await User.findOne(userLookupQuery(req.params.id))
        .select('followers following privacy blockedUsers')
        .lean();

    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, req);
    if (access.blocked) {
        return next(new AppError('Bu kullanıcıya erişilemiyor.', 403));
    }
    if (access.isLocked) {
        return next(new AppError('Bu hesap kilitli.', 403));
    }

    const totalFollowers = user.followers ? user.followers.length : 0;
    const paginatedIds = user.followers ? user.followers.slice(skip, skip + limit) : [];

    const followers = await User.find({ _id: { $in: paginatedIds } })
        .select('_id name username avatar isVerified rank')
        .lean();

    const hasMore = skip + paginatedIds.length < totalFollowers;

    res.status(200).json({
        status: 'success',
        hasMore,
        data: { users: followers }
    });
});

export const getFollowingList = catchAsync(async (req, res, next) => {
    const { page, limit, skip } = parseFollowListPaging(req.query);

    const user = await User.findOne(userLookupQuery(req.params.id))
        .select('following followers privacy blockedUsers')
        .lean();

    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, req);
    if (access.blocked) {
        return next(new AppError('Bu kullanıcıya erişilemiyor.', 403));
    }
    if (access.isLocked) {
        return next(new AppError('Bu hesap kilitli.', 403));
    }

    const totalFollowing = user.following ? user.following.length : 0;
    const paginatedIds = user.following ? user.following.slice(skip, skip + limit) : [];

    const following = await User.find({ _id: { $in: paginatedIds } })
        .select('_id name username avatar isVerified rank')
        .lean();

    const hasMore = skip + paginatedIds.length < totalFollowing;

    res.status(200).json({
        status: 'success',
        hasMore,
        data: { users: following }
    });
});

export const getUsersByIds = catchAsync(async (req, res, next) => {
    const { userIds } = req.body || {};

    if (!Array.isArray(userIds)) {
        return next(new AppError('Kullanıcı listesi geçersiz.', 400));
    }

    if (userIds.length > 200) {
        return next(new AppError('Tek istekte en fazla 200 kullanıcı getirilebilir.', 400));
    }

    const normalizedIds = [...new Set(
        userIds
            .map((id) => String(id).trim())
            .filter((id) => mongoose.isValidObjectId(id))
    )];

    if (normalizedIds.length === 0) {
        return res.status(200).json({
            status: 'success',
            results: 0,
            data: { users: [] }
        });
    }

    const users = await User.find({ _id: { $in: normalizedIds } })
        .select('_id name username avatar isVerified rank userType activeProfileMode businessProfile')
        .lean();

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const orderedUsers = normalizedIds
        .map((id) => usersById.get(id))
        .filter(Boolean);

    res.status(200).json({
        status: 'success',
        results: orderedUsers.length,
        data: { users: orderedUsers }
    });
});

export const getUserBio = catchAsync(async (req, res, next) => {
    const user = await User.findOne(userLookupQuery(req.params.id))
        .select('bioBlocks followers privacy blockedUsers')
        .lean();
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, req);
    if (access.blocked) {
        return next(new AppError('Bu kullanıcıya erişilemiyor.', 403));
    }
    if (access.isLocked) {
        return res.status(200).json({
            status: 'success',
            bioBlocks: [],
            isLocked: true
        });
    }

    res.status(200).json({
        status: 'success',
        bioBlocks: user.bioBlocks || [],
        isLocked: false
    });
});


export const FREE_BIO_BLOCK_TYPES = [
    'TEXT',
    'BRAND_LOGO',
    'SOCIAL_LINK',
    'DIVIDER',
    'GARAGE_WIDGET'
];

export const PRO_BIO_BLOCK_TYPES = [
    'STAT',
    'SPOTIFY',
    'YOUTUBE_MUSIC',
    'TELEMETRY_HOLOGRAM',
    'EXHAUST_NOTE',
    'ROUTE_SHOWCASE',
    'ACHIEVEMENT_BADGE',
    'MAINTENANCE_CARD'
];

export const ALL_BIO_BLOCK_TYPES = [...FREE_BIO_BLOCK_TYPES, ...PRO_BIO_BLOCK_TYPES];

const TYPE_NORMALIZATION_MAP = {
    text: 'TEXT',
    TEXT: 'TEXT',
    brandLogo: 'BRAND_LOGO',
    brand_logo: 'BRAND_LOGO',
    BRAND_LOGO: 'BRAND_LOGO',
    socialLink: 'SOCIAL_LINK',
    social_link: 'SOCIAL_LINK',
    SOCIAL_LINK: 'SOCIAL_LINK',
    divider: 'DIVIDER',
    DIVIDER: 'DIVIDER',
    garageWidget: 'GARAGE_WIDGET',
    garage_widget: 'GARAGE_WIDGET',
    GARAGE_WIDGET: 'GARAGE_WIDGET',
    stat: 'STAT',
    STAT: 'STAT',
    spotify: 'SPOTIFY',
    SPOTIFY: 'SPOTIFY',
    youtubeMusic: 'YOUTUBE_MUSIC',
    youtube_music: 'YOUTUBE_MUSIC',
    YOUTUBE_MUSIC: 'YOUTUBE_MUSIC',
    telemetryHologram: 'TELEMETRY_HOLOGRAM',
    telemetry_hologram: 'TELEMETRY_HOLOGRAM',
    TELEMETRY_HOLOGRAM: 'TELEMETRY_HOLOGRAM',
    exhaustNote: 'EXHAUST_NOTE',
    exhaust_note: 'EXHAUST_NOTE',
    EXHAUST_NOTE: 'EXHAUST_NOTE',
    routeShowcase: 'ROUTE_SHOWCASE',
    route_showcase: 'ROUTE_SHOWCASE',
    ROUTE_SHOWCASE: 'ROUTE_SHOWCASE',
    achievementBadge: 'ACHIEVEMENT_BADGE',
    achievement_badge: 'ACHIEVEMENT_BADGE',
    ACHIEVEMENT_BADGE: 'ACHIEVEMENT_BADGE',
    maintenanceCard: 'MAINTENANCE_CARD',
    maintenance_card: 'MAINTENANCE_CARD',
    MAINTENANCE_CARD: 'MAINTENANCE_CARD'
};

function sanitizeString(str, maxLen = 200, fallback = '') {
    if (typeof str !== 'string') return fallback;
    const clean = str.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    return clean.slice(0, maxLen);
}

function sanitizeUrl(urlStr, maxLen = 400) {
    if (!urlStr || typeof urlStr !== 'string') return '';
    const clean = urlStr.trim();
    if (clean.length > maxLen) return '';
    if (clean.startsWith('/api/uploads/')) return clean;
    try {
        const parsed = new URL(clean);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return clean;
        }
    } catch (_) {}
    return '';
}

/**
 * @param {Array} rawBlocks
 * @param {object} user - mongoose user doc (garage, unlockedAchievements, savedRoutes, isPro…)
 * @param {object} [options]
 * @param {string[]} [options.authoredRouteIds] - routes where user is author (Studio getMyRoutes)
 */
export function validateAndSanitizeBioBlocks(rawBlocks, user, options = {}) {
    if (!Array.isArray(rawBlocks)) {
        return { error: 'Blok listesi dizi formatında olmalıdır.' };
    }

    const isPro = Boolean(user.isPro && (!user.proExpiryDate || user.proExpiryDate > new Date()));
    const maxBlocks = isPro ? 20 : 5;

    if (rawBlocks.length > maxBlocks) {
        return {
            error: `Maksimum blok sayısını (${maxBlocks}) aştınız. Sınırsız özellikler ve 20 blok için MotoVibe PRO'ya geçin.`,
            status: 403
        };
    }

    const userGarageIds = new Set(
        (Array.isArray(user.garage) ? user.garage : []).map(b => (b._id || b.id || '').toString())
    );
    const userUnlockedAchIds = new Set(
        (Array.isArray(user.unlockedAchievements) ? user.unlockedAchievements : []).map(id => id.toString())
    );
    // Studio picks from getMyRoutes (author) OR saved favorites — allow both.
    const userRouteIds = new Set([
        ...(Array.isArray(user.savedRoutes) ? user.savedRoutes : []).map(id => id.toString()),
        ...(Array.isArray(options.authoredRouteIds) ? options.authoredRouteIds : []).map(id => id.toString()),
        ...(Array.isArray(user.authoredRouteIds) ? user.authoredRouteIds : []).map(id => id.toString())
    ]);

    // Union of Mod Shop + BioRenderer + legacy aliases (diamond/noise)
    const validBgTypes = [
        'transparent', 'surface', 'elevated', 'dark metal', 'solid', 'glass',
        'gradient', 'carbon', 'asphalt', 'circuit', 'brushed', 'mesh',
        'diamond', 'noise'
    ];
    const validEffects = ['none', 'outline', 'shadow', 'glow', 'neon', 'glitch', 'retro', 'chrome', 'fire', 'ice', 'emboss'];

    const sanitizedBlocks = [];

    for (let i = 0; i < rawBlocks.length; i += 1) {
        const raw = rawBlocks[i];
        if (!raw || typeof raw !== 'object') {
            return { error: `${i + 1}. blok geçersiz nesne formatında.` };
        }

        const rawType = String(raw.type || '').trim();
        const canonicalType = TYPE_NORMALIZATION_MAP[rawType] || 'TEXT';

        if (!ALL_BIO_BLOCK_TYPES.includes(canonicalType)) {
            return { error: `${i + 1}. blokta bilinmeyen blok tipi: ${rawType}` };
        }

        if (PRO_BIO_BLOCK_TYPES.includes(canonicalType) && !isPro) {
            return {
                error: 'İstatistik, Spotify, YouTube Music, Telemetri, Egzoz, Rota, Başarım Rozeti ve Bakım Kartı blokları sadece MotoVibe PRO abonelerine özeldir.',
                status: 403,
                requiresPro: true
            };
        }

        const blockId = sanitizeString(raw.id, 64, `block_${Date.now()}_${i}`);
        const order = Number.isInteger(Number(raw.order)) ? Math.max(0, Number(raw.order)) : i;

        // Sanitize Style — strictly preserving all MotoVibe Studio FE contract fields
        const rawStyle = (raw.style && typeof raw.style === 'object') ? raw.style : {};

        const gridHeightVal = (rawStyle.gridHeight !== undefined && rawStyle.gridHeight !== null)
            ? (Number.isFinite(Number(rawStyle.gridHeight)) ? Math.max(1, Math.min(24000, Math.round(Number(rawStyle.gridHeight)))) : null)
            : (rawStyle.gridH !== undefined && rawStyle.gridH !== null && Number.isFinite(Number(rawStyle.gridH))
                ? Math.max(1, Math.min(24000, Math.round(Number(rawStyle.gridH))))
                : null);

        const sanitizedStyle = {
            color: sanitizeString(rawStyle.color, 32, '#FFFFFF'),
            font: sanitizeString(rawStyle.font, 32, 'Street'),
            align: ['left', 'center', 'right'].includes(rawStyle.align) ? rawStyle.align : 'left',
            bgType: validBgTypes.includes(rawStyle.bgType) ? rawStyle.bgType : 'transparent',
            animate: rawStyle.animate !== undefined ? Boolean(rawStyle.animate) : true,
            effect: validEffects.includes(rawStyle.effect) ? rawStyle.effect : 'none',
            opacity: Number.isFinite(Number(rawStyle.opacity)) ? Math.max(0.0, Math.min(1.0, Number(rawStyle.opacity))) : 1.0,
            borderWidth: Number.isFinite(Number(rawStyle.borderWidth)) ? Math.max(0.0, Math.min(10.0, Number(rawStyle.borderWidth))) : 1.0,
            borderRadius: Number.isFinite(Number(rawStyle.borderRadius)) ? Math.max(0.0, Math.min(50.0, Number(rawStyle.borderRadius))) : 20.0,
            shadowGlow: Number.isFinite(Number(rawStyle.shadowGlow)) ? Math.max(0.0, Math.min(50.0, Number(rawStyle.shadowGlow))) : 0.0,
            boxWidth: Number.isFinite(Number(rawStyle.boxWidth)) ? Math.max(25.0, Math.min(100.0, Number(rawStyle.boxWidth))) : 100.0,
            boxHeight: Number.isFinite(Number(rawStyle.boxHeight)) ? Math.max(0.0, Math.min(100.0, Number(rawStyle.boxHeight))) : 14.0,
            textScale: Number.isFinite(Number(rawStyle.textScale)) ? Math.max(0.5, Math.min(3.0, Number(rawStyle.textScale))) : 1.0,
            letterSpacing: Number.isFinite(Number(rawStyle.letterSpacing)) ? Math.max(-5.0, Math.min(20.0, Number(rawStyle.letterSpacing))) : 0.0,
            lineHeight: Number.isFinite(Number(rawStyle.lineHeight)) ? Math.max(0.5, Math.min(3.0, Number(rawStyle.lineHeight))) : 1.2,
            rotation: Number.isFinite(Number(rawStyle.rotation)) ? Math.max(-360.0, Math.min(360.0, Number(rawStyle.rotation))) : 0.0,
            gridX: (rawStyle.gridX !== undefined && rawStyle.gridX !== null && Number.isFinite(Number(rawStyle.gridX)))
                ? Math.max(0, Math.min(1000, Math.round(Number(rawStyle.gridX))))
                : null,
            gridY: (rawStyle.gridY !== undefined && rawStyle.gridY !== null && Number.isFinite(Number(rawStyle.gridY)))
                ? Math.max(0, Math.min(24000, Math.round(Number(rawStyle.gridY))))
                : null,
            gridHeight: gridHeightVal,
            isLocked: Boolean(rawStyle.isLocked),
            isPinned: Boolean(rawStyle.isPinned),
            isVisible: rawStyle.isVisible !== undefined ? Boolean(rawStyle.isVisible) : true
        };

        // Sanitize Data
        const rawData = (raw.data && typeof raw.data === 'object') ? raw.data : {};
        let sanitizedData = {};

        switch (canonicalType) {
            case 'TEXT':
                sanitizedData = {
                    text: sanitizeString(rawData.text, 500),
                    isNeon: Boolean(rawData.isNeon),
                    size: ['small', 'medium', 'large', 'huge'].includes(rawData.size) ? rawData.size : 'medium'
                };
                break;
            case 'BRAND_LOGO':
                sanitizedData = {
                    brandName: sanitizeString(rawData.brandName || rawData.brand, 50, 'Ducati'),
                    size: Number.isFinite(Number(rawData.size)) ? Math.max(20, Math.min(200, Number(rawData.size))) : 60,
                    logoUrl: sanitizeUrl(rawData.logoUrl)
                };
                break;
            case 'SOCIAL_LINK':
                sanitizedData = {
                    platform: sanitizeString(rawData.platform, 30, 'Instagram'),
                    url: sanitizeUrl(rawData.url),
                    label: sanitizeString(rawData.label, 40, 'Takip et'),
                    handle: sanitizeString(rawData.handle, 60, '@rider')
                };
                break;
            case 'DIVIDER':
                sanitizedData = {
                    glowColor: sanitizeString(rawData.glowColor, 32, '#D4AF37'),
                    variant: sanitizeString(rawData.variant, 30, 'road')
                };
                break;
            case 'GARAGE_WIDGET': {
                const rawBikeId = sanitizeString(rawData.bikeId, 64);
                const bikeOwned = !rawBikeId || userGarageIds.has(rawBikeId);
                sanitizedData = {
                    bikeId: bikeOwned ? rawBikeId : '',
                    customTitle: sanitizeString(rawData.customTitle, 60)
                };
                break;
            }
            case 'STAT':
                sanitizedData = {
                    label: sanitizeString(rawData.label, 40, 'Top Speed'),
                    value: sanitizeString(rawData.value, 30, '299'),
                    unit: sanitizeString(rawData.unit, 20, 'km/h'),
                    progress: Number.isFinite(Number(rawData.progress)) ? Math.max(0, Math.min(1, Number(rawData.progress))) : 0.0
                };
                break;
            case 'SPOTIFY': {
                const spTrack = sanitizeUrl(rawData.trackUrl);
                const isValidSp = !spTrack || /^https:\/\/(open\.spotify\.com|spotify\.link)\/.+$/.test(spTrack);
                sanitizedData = {
                    trackUrl: isValidSp ? spTrack : '',
                    trackName: sanitizeString(rawData.trackName, 100),
                    artistName: sanitizeString(rawData.artistName, 100),
                    coverUrl: sanitizeUrl(rawData.coverUrl),
                    isPlaying: Boolean(rawData.isPlaying)
                };
                break;
            }
            case 'YOUTUBE_MUSIC': {
                const ytTrack = sanitizeUrl(rawData.trackUrl);
                const isValidYt = !ytTrack || /^https:\/\/(music\.youtube\.com|youtu\.be|www\.youtube\.com)\/.+$/.test(ytTrack);
                sanitizedData = {
                    trackUrl: isValidYt ? ytTrack : '',
                    trackName: sanitizeString(rawData.trackName, 100),
                    artistName: sanitizeString(rawData.artistName, 100),
                    lastfmUsername: sanitizeString(rawData.lastfmUsername, 60),
                    coverUrl: sanitizeUrl(rawData.coverUrl),
                    isPlaying: Boolean(rawData.isPlaying)
                };
                break;
            }
            case 'TELEMETRY_HOLOGRAM':
                sanitizedData = {
                    layout: sanitizeString(rawData.layout, 30, 'radar'),
                    title: sanitizeString(rawData.title, 60, 'TOP SPEED'),
                    primaryLabel: sanitizeString(rawData.primaryLabel, 40, 'TOP SPEED'),
                    primaryValue: sanitizeString(rawData.primaryValue, 40),
                    primaryUnit: sanitizeString(rawData.primaryUnit, 20, 'KM/H'),
                    secondaryLabel: sanitizeString(rawData.secondaryLabel, 40, 'KM TOPLAM'),
                    secondaryValue: sanitizeString(rawData.secondaryValue, 40),
                    secondaryUnit: sanitizeString(rawData.secondaryUnit, 20, 'KM')
                };
                break;
            case 'EXHAUST_NOTE': {
                const exAudio = sanitizeUrl(rawData.audioUrl);
                // audio must be from our CDN or standard format
                const isValidAudio = !exAudio || /\.(mp3|wav|aac|ogg)$/i.test(exAudio) || exAudio.startsWith('/api/uploads/');
                sanitizedData = {
                    exhaustName: sanitizeString(rawData.exhaustName, 60, 'Akrapovic Titanium'),
                    audioUrl: isValidAudio ? exAudio : '',
                    isPlaying: Boolean(rawData.isPlaying)
                };
                break;
            }
            case 'ROUTE_SHOWCASE': {
                const rawRouteId = sanitizeString(rawData.routeId, 64);
                const routeOwned = !rawRouteId || userRouteIds.has(rawRouteId);
                sanitizedData = {
                    routeId: routeOwned ? rawRouteId : '',
                    title: sanitizeString(rawData.title, 80, 'Favori Rota'),
                    distance: sanitizeString(rawData.distance, 30, '42 km'),
                    location: sanitizeString(rawData.location, 60, 'İstanbul'),
                    difficulty: sanitizeString(rawData.difficulty, 30, 'Akıcı'),
                    highlight: sanitizeString(rawData.highlight, 200),
                    imageUrl: sanitizeUrl(rawData.imageUrl),
                    coordinates: Array.isArray(rawData.coordinates) ? rawData.coordinates.slice(0, 100) : []
                };
                break;
            }
            case 'ACHIEVEMENT_BADGE': {
                const rawAchId = sanitizeString(rawData.achievementId, 64);
                const achUnlocked = !rawAchId || userUnlockedAchIds.has(rawAchId);
                sanitizedData = {
                    achievementId: achUnlocked ? rawAchId : '',
                    title: sanitizeString(rawData.title, 80, 'MotoVibe Başarımı'),
                    subtitle: sanitizeString(rawData.subtitle, 140),
                    metric: sanitizeString(rawData.metric, 40),
                    rank: sanitizeString(rawData.rank, 30, 'Carbon')
                };
                break;
            }
            case 'MAINTENANCE_CARD':
                sanitizedData = {
                    maintenanceType: sanitizeString(rawData.maintenanceType, 40, 'GENEL BAKIM'),
                    title: sanitizeString(rawData.title, 80, 'Bakım Takibi'),
                    nextService: sanitizeString(rawData.nextService, 40, '1.200 km sonra'),
                    odometer: sanitizeString(rawData.odometer, 40, '18.400 km'),
                    note: sanitizeString(rawData.note, 200),
                    progress: Number.isFinite(Number(rawData.progress)) ? Math.max(0, Math.min(1, Number(rawData.progress))) : 0.72,
                    isOverdue: Boolean(rawData.isOverdue)
                };
                break;
            default:
                sanitizedData = rawData;
                break;
        }

        sanitizedBlocks.push({
            id: blockId,
            type: canonicalType,
            order,
            style: sanitizedStyle,
            data: sanitizedData
        });
    }

    return { value: sanitizedBlocks };
}

export const updateProfile = catchAsync(async (req, res, next) => {
    // 1) Create error if user POSTs password data
    if (req.body.password || req.body.passwordConfirm) {
        return next(new AppError('Bu rota üzerinden şifre güncellenemez.', 400));
    }

    // Alias desteği
    if (req.body.displayName && !req.body.name) req.body.name = req.body.displayName;
    if (req.body.avatarUrl && !req.body.avatar) req.body.avatar = req.body.avatarUrl;
    if (req.body.coverUrl && !req.body.coverImage) req.body.coverImage = req.body.coverUrl;

    // 2) Filtered out unwanted field names that are not allowed to be updated
    const allowedFields = [
        'name', 'email', 'username', 'bio', 'location', 
        'coverImage', 'avatar', 'phone', 'emergencyPhone', 
        'address', 'bioBlocks', 'ridingPace'
    ];
    const filteredBody = {};
    Object.keys(req.body).forEach(el => {
        if (allowedFields.includes(el)) filteredBody[el] = req.body[el];
    });

    if (filteredBody.username) {
        filteredBody.username = filteredBody.username.toLowerCase().trim();
        const usernameRegex = /^[a-z0-9_]{3,20}$/;
        if (!usernameRegex.test(filteredBody.username)) {
            return next(new AppError('Geçersiz kullanıcı adı formatı.', 400));
        }
        if (isReservedUsername(filteredBody.username) && (!req.user || !req.user.isAdmin)) {
            return next(new AppError('Bu kullanıcı adı alınamaz. Marka veya sistem politikası gereği rezerve edilmiştir.', 400));
        }
        const existingUser = await User.findOne({ username: filteredBody.username, _id: { $ne: req.user.id } });
        if (existingUser) {
            return next(new AppError('Bu kullanıcı adı maalesef başkası tarafından kullanılıyor.', 400));
        }
    }

    // Email Uniqueness & Validation Check
    if (filteredBody.email) {
        filteredBody.email = filteredBody.email.toLowerCase().trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(filteredBody.email)) {
            return next(new AppError('Geçersiz e-posta adresi formatı.', 400));
        }
        const existingEmail = await User.findOne({ email: filteredBody.email, _id: { $ne: req.user.id } });
        if (existingEmail) {
            return next(new AppError('Bu e-posta adresi zaten başka bir hesap tarafından kullanılıyor.', 409));
        }
    }

    // URL Scheme Validation (Deny javascript:, data:, vbscript:)
    const isSafeUrlScheme = (url) => {
        if (!url || typeof url !== 'string') return true;
        const trimmed = url.trim().toLowerCase();
        if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
            return false;
        }
        return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/');
    };

    if (filteredBody.avatar && !isSafeUrlScheme(filteredBody.avatar)) {
        return next(new AppError('Geçersiz profil fotoğrafı bağlantı formatı.', 400));
    }
    if (filteredBody.coverImage && !isSafeUrlScheme(filteredBody.coverImage)) {
        return next(new AppError('Geçersiz kapak fotoğrafı bağlantı formatı.', 400));
    }

    // 3) Update user document
    // For Mixed type arrays (bioBlocks), validate and sanitize strictly
    if (filteredBody.bioBlocks !== undefined) {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ status: 'fail', message: 'Kullanıcı bulunamadı.' });
        }

        // Studio route picker uses /routes/my (author), not only savedRoutes favorites
        const authoredRoutes = await Route.find({ author: user._id }).select('_id').lean();
        const authoredRouteIds = authoredRoutes.map((r) => r._id.toString());

        const validation = validateAndSanitizeBioBlocks(filteredBody.bioBlocks, user, {
            authoredRouteIds
        });
        if (validation.error) {
            return res.status(validation.status || 400).json({
                status: 'fail',
                message: validation.error,
                requiresPro: validation.requiresPro
            });
        }

        // Apply all other fields
        Object.keys(filteredBody).forEach(key => {
            if (key !== 'bioBlocks') user[key] = filteredBody[key];
        });

        // Set sanitized bioBlocks and mark modified
        user.bioBlocks = validation.value;
        user.markModified('bioBlocks');
        await user.save({ validateBeforeSave: false });

        // Re-fetch from DB to guarantee correct response
        const savedUser = await User.findById(req.user.id).select('-password');

        return res.status(200).json({
            status: 'success',
            data: { user: savedUser }
        });
    }

    // Standard update for non-Mixed fields
    const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
        new: true,
        runValidators: true
    }).select('-password');

    res.status(200).json({
        status: 'success',
        data: {
            user: updatedUser
        }
    });
});

export const updateSettings = catchAsync(async (req, res, next) => {
    // fields: privacy (obj), notifications (obj), password (handled via auth route usually, but here we might just do settings)
    // The prompt requested a specific PUT /api/users/update-settings
    // Password change usually requires a separate sensitive route, but we can check if it's here.
    // NOTE: For password change, we'll keep it simple or strictly separate.
    // Let's handle privacy and notifications here.

    const allowedFields = ['privacy', 'notifications'];
    const filteredBody = {};
    Object.keys(req.body).forEach(el => {
        if (allowedFields.includes(el)) filteredBody[el] = req.body[el];
    });

    const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
        new: true,
        runValidators: true
    }).select('-password -spotifyRefreshToken');

    res.status(200).json({
        status: 'success',
        data: {
            user: updatedUser
        }
    });
});

export const updatePassword = catchAsync(async (req, res, next) => {
    // Since user requested "Change Password flow", we need a controller for it.
    // This typically requires: currentPassword, password, passwordConfirm
    const { currentPassword, password, passwordConfirm } = req.body;

    if ([currentPassword, password, passwordConfirm].some((value) => typeof value !== 'string')) {
        return next(new AppError('Mevcut sifre, yeni sifre ve sifre tekrari zorunludur.', 400));
    }
    if (password.length < 8 || password.length > 128) {
        return next(new AppError('Yeni sifre 8-128 karakter arasinda olmalidir.', 422));
    }
    if (password !== passwordConfirm) {
        return next(new AppError('Sifreler eslesmiyor.', 422));
    }

    // 1) Get user from collection
    const user = await User.findById(req.user.id).select('+password +tokenVersion +refreshSessions');

    if (!user) {
        return next(new AppError('Kullanici bulunamadi.', 404));
    }

    // 2) Check if POSTed current password is correct
    if (!(await user.correctPassword(currentPassword, user.password))) {
        return next(new AppError('Mevcut şifreniz hatalı.', 401));
    }

    // 3) Update
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(password, salt);
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    user.refreshSessions = [];

    await user.save();

    await createSendToken(user, 200, res);
    const disconnectTimer = setTimeout(() => disconnectUserSessions(user._id), 1000);
    disconnectTimer.unref?.();
});

export const searchUsers = catchAsync(async (req, res, next) => {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || !q.trim()) {
        return next(new AppError('Arama terimi giriniz.', 400));
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const escapedQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = {
        isDeleted: { $ne: true },
        $or: [
            { name: { $regex: escapedQuery, $options: 'i' } },
            { username: { $regex: escapedQuery, $options: 'i' } }
        ]
    };

    if (req.user?.id) {
        const myBlocked = req.user.blockedUsers || [];
        if (myBlocked.length > 0) {
            query._id = { $nin: myBlocked };
        }
    }

    const users = await User.find(query)
        .select('_id name username avatar isVerified rank bio coverImage followers following postsCount totalKm userType activeProfileMode businessProfile')
        .skip(skip)
        .limit(limit)
        .lean();

    const totalUsers = await User.countDocuments(query);
    const hasMore = skip + users.length < totalUsers;

    res.status(200).json({
        status: 'success',
        results: users.length,
        hasMore,
        data: {
            users
        }
    });
});

export const getProfessionalProfiles = catchAsync(async (req, res, next) => {
    const { category, q, verified, lat, lng, radius, limit } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 60);
    const filter = {
        userType: 'PROFESSIONAL',
        $and: [
            {
                $or: [
                    { activeProfileMode: 'PROFESSIONAL' },
                    { activeProfileMode: { $exists: false } }
                ]
            }
        ]
    };

    if (category && BUSINESS_CATEGORIES.includes(String(category))) {
        filter['businessProfile.category'] = String(category);
    }

    if (String(verified || '').toLowerCase() === 'true') {
        filter.$and.push({
            $or: [
                { isVerified: true },
                { 'businessProfile.verifiedBadge': true }
            ]
        });
    }

    const hasLatitude = lat !== undefined && String(lat).trim() !== '';
    const hasLongitude = lng !== undefined && String(lng).trim() !== '';
    if (hasLatitude !== hasLongitude) {
        return next(new AppError('Yakınlık filtresi için enlem ve boylam birlikte gönderilmelidir.', 400));
    }

    let hasNearbyFilter = false;
    if (hasLatitude && hasLongitude) {
        const latitude = Number(lat);
        const longitude = Number(lng);
        const radiusKm = radius === undefined || String(radius).trim() === ''
            ? 30
            : Number(radius);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return next(new AppError('Yakınlık filtresi için geçerli koordinatlar gönderilmelidir.', 400));
        }
        if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 300) {
            return next(new AppError('Yakınlık yarıçapı 1 ile 300 km arasında olmalıdır.', 400));
        }
        filter['businessProfile.address'] = {
            $near: {
                $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                $maxDistance: Math.round(radiusKm * 1000)
            }
        };
        hasNearbyFilter = true;
    }

    if (q && String(q).trim().length > 0) {
        const regex = new RegExp(escapeRegex(String(q).trim()), 'i');
        filter.$and.push({
            $or: [
                { name: regex },
                { username: regex },
                { 'businessProfile.services': regex }
            ]
        });
    }
    let professionalsQuery = User.find(filter)
        .select('_id name username avatar rank isVerified verificationStatus followers postsCount totalKm userType activeProfileMode businessProfile')
        .limit(safeLimit)
        .lean();
    if (!hasNearbyFilter) {
        professionalsQuery = professionalsQuery.sort({
            'businessProfile.verifiedBadge': -1,
            postsCount: -1,
            createdAt: -1
        });
    }
    const professionals = await professionalsQuery;

    const normalized = professionals.map((user) => {
        normalizeProfessionalStatusForResponse(user);
        return {
            ...user,
            businessProfile: businessProfileForPublic(user.businessProfile),
            followers: Array.isArray(user.followers) ? user.followers.length : (user.followers || 0),
            following: 0
        };
    });

    res.status(200).json({
        status: 'success',
        results: normalized.length,
        data: {
            professionals: normalized
        }
    });
});

export const updateProfileMode = catchAsync(async (req, res, next) => {
    const mode = String(req.body?.mode || '').toUpperCase().trim();
    if (!['PERSONAL', 'PROFESSIONAL'].includes(mode)) {
        return next(new AppError('Geçersiz profil modu.', 400));
    }

    const user = await User.findById(req.user.id).select('userType activeProfileMode businessProfile isPro isVerified verificationStatus');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (mode === 'PROFESSIONAL' && user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Profesyonel profil modunu kullanmak icin BIZ hesabini aktiflestir.', 403));
    }

    user.activeProfileMode = mode;
    normalizeProfessionalStatusForResponse(user);
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: mode === 'PROFESSIONAL'
            ? 'Profesyonel profil modu aktif edildi.'
            : 'Kisisel profil modu aktif edildi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    });
});

export const getAllUsers = catchAsync(async (req, res, next) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    // Strict allowlist query builder - NO raw req.query pass-through to prevent query injection
    const query = {};

    if (typeof req.query.search === 'string' && req.query.search.trim()) {
        const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
            { name: { $regex: escaped, $options: 'i' } },
            { username: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } }
        ];
    }

    if (typeof req.query.userType === 'string' && ['INDIVIDUAL', 'PROFESSIONAL'].includes(req.query.userType)) {
        query.userType = req.query.userType;
    }

    if (typeof req.query.isVerified === 'string') {
        query.isVerified = req.query.isVerified === 'true';
    }

    const [users, totalUsers] = await Promise.all([
        User.find(query)
            .select('_id name username email avatar rank isVerified verificationStatus isAdmin joinDate userType activeProfileMode businessProfile followers following')
            .skip(skip)
            .limit(limit)
            .lean(),
        User.countDocuments(query)
    ]);

    const hasMore = skip + users.length < totalUsers;

    // Convert follower/following arrays to counts for lightweight response
    const usersWithCounts = users.map(user => ({
        ...user,
        followers: Array.isArray(user.followers) ? user.followers.length : (user.followers || 0),
        following: Array.isArray(user.following) ? user.following.length : (user.following || 0),
    }));

    res.status(200).json({
        status: 'success',
        results: usersWithCounts.length,
        total: totalUsers,
        hasMore,
        data: usersWithCounts
    });
});

// --- GARAGE CONTROLLERS ---

export const getGarage = catchAsync(async (req, res, next) => {
    const targetUserId = req.query.userId || req.user.id;
    const user = await User.findById(targetUserId).select('name username garage primaryBike bikeModel');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const garage = user.garage || [];
    res.status(200).json({
        status: 'success',
        results: garage.length,
        data: {
            garage,
            primaryBike: user.primaryBike || user.bikeModel || '',
            userName: user.name || user.username
        }
    });
});

export const addToGarage = catchAsync(async (req, res, next) => {
    const { brand, model, year, image, km, color, cc, hp, style, isPrimary } = req.body;

    if (!brand || !model || !brand.trim() || !model.trim()) {
        return next(new AppError('Motosiklet marka ve modeli zorunludur.', 400));
    }

    const user = await User.findById(req.user.id);
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.garage && user.garage.length >= 20) {
        return next(new AppError('Garajınızda en fazla 20 motosiklet barındırabilirsiniz.', 400));
    }

    const shouldBePrimary = isPrimary === true || user.garage.length === 0;

    if (shouldBePrimary && user.garage.length > 0) {
        user.garage.forEach(b => { b.isPrimary = false; });
    }

    const newBike = {
        brand: brand.trim(),
        model: model.trim(),
        year: Number(year) || new Date().getFullYear(),
        image: image && typeof image === 'string' && image.trim() ? image.trim() : null,
        km: Number(km) >= 0 ? Number(km) : 0,
        color: color ? color.trim() : null,
        cc: Number(cc) > 0 ? Number(cc) : undefined,
        hp: Number(hp) > 0 ? Number(hp) : undefined,
        style: style || 'UNKNOWN',
        isPrimary: shouldBePrimary,
        _id: new mongoose.Types.ObjectId()
    };

    user.garage.push(newBike);

    if (shouldBePrimary) {
        user.primaryBike = `${brand.trim()} ${model.trim()}`;
        user.bikeModel = `${brand.trim()} ${model.trim()}`;
    }

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);

    res.status(201).json({
        status: 'success',
        message: 'Motosiklet garaja eklendi.',
        data: {
            bike: newBike,
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    });
});

export const removeFromGarage = catchAsync(async (req, res, next) => {
    const { garageId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    const bikeIndex = user.garage.findIndex(b => b._id.toString() === garageId);
    if (bikeIndex === -1) {
        return next(new AppError('Motosiklet bulunamadı.', 404));
    }

    const wasPrimary = user.garage[bikeIndex].isPrimary ||
        user.primaryBike === `${user.garage[bikeIndex].brand} ${user.garage[bikeIndex].model}`;

    user.garage.splice(bikeIndex, 1);

    if (wasPrimary) {
        if (user.garage.length > 0) {
            user.garage[0].isPrimary = true;
            user.primaryBike = `${user.garage[0].brand} ${user.garage[0].model}`;
            user.bikeModel = `${user.garage[0].brand} ${user.garage[0].model}`;
        } else {
            user.primaryBike = '';
            user.bikeModel = '';
        }
    }

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(req.user.id);

    res.status(200).json({
        status: 'success',
        message: 'Motosiklet garajdan silindi.',
        data: {
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    });
});

export const setPrimaryBike = catchAsync(async (req, res, next) => {
    const { garageId } = req.body;
    if (!garageId) {
        return next(new AppError('Motosiklet ID gereklidir.', 400));
    }

    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return next(new AppError('Motosiklet bulunamadı.', 404));

    user.garage.forEach(b => {
        b.isPrimary = (b._id.toString() === garageId);
    });

    user.primaryBike = `${bike.brand} ${bike.model}`;
    user.bikeModel = `${bike.brand} ${bike.model}`;

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Birincil motosiklet güncellendi.',
        data: {
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    });
});

export const verifyGarageItem = catchAsync(async (req, res, next) => {
    const { garageId } = req.params;
    const { verificationImage } = req.body;

    if (!verificationImage) {
        return next(new AppError('Doğrulama görseli gereklidir.', 400));
    }

    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return next(new AppError('Motosiklet bulunamadı.', 404));

    bike.verificationImage = verificationImage;
    bike.verificationStatus = 'pending';
    bike.isVerified = false;

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);
    await refreshPackGlobalRanks();

    res.status(200).json({
        status: 'success',
        message: 'Doğrulama talebi gönderildi.',
        data: {
            bike,
            garage: user.garage
        }
    });
});

export const updateGarageItem = catchAsync(async (req, res, next) => {
    const { garageId } = req.params;
    const { brand, model, year, image, km, color, cc, hp, style, isPrimary } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return next(new AppError('Motosiklet bulunamadı.', 404));

    if (brand && brand.trim()) bike.brand = brand.trim();
    if (model && model.trim()) bike.model = model.trim();
    if (year !== undefined) bike.year = Number(year) || bike.year;
    if (image !== undefined) bike.image = image && typeof image === 'string' && image.trim() ? image.trim() : null;
    if (km !== undefined) bike.km = Number(km) >= 0 ? Number(km) : bike.km;
    if (color !== undefined) bike.color = color ? color.trim() : null;
    if (cc !== undefined) bike.cc = Number(cc) > 0 ? Number(cc) : undefined;
    if (hp !== undefined) bike.hp = Number(hp) > 0 ? Number(hp) : undefined;
    if (style !== undefined) bike.style = style || 'UNKNOWN';

    if (isPrimary === true) {
        user.garage.forEach(b => {
            b.isPrimary = (b._id.toString() === garageId);
        });
        user.primaryBike = `${bike.brand} ${bike.model}`;
        user.bikeModel = `${bike.brand} ${bike.model}`;
    } else if (isPrimary === false && bike.isPrimary) {
        bike.isPrimary = false;
    }

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);

    res.status(200).json({
        status: 'success',
        message: 'Motosiklet güncellendi.',
        data: {
            bike,
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    });
});

export const addMaintenanceRecord = catchAsync(async (req, res, next) => {
    const { garageId } = req.params;
    const { title, km, cost, serviceName, description, date } = req.body;

    if (!title || !title.trim()) {
        return next(new AppError('Bakım başlığı zorunludur.', 400));
    }

    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return next(new AppError('Motosiklet bulunamadı.', 404));

    if (!bike.maintenanceRecords) {
        bike.maintenanceRecords = [];
    }

    const record = {
        title: title.trim(),
        km: Number(km) >= 0 ? Number(km) : undefined,
        cost: Number(cost) >= 0 ? Number(cost) : undefined,
        serviceName: serviceName && serviceName.trim() ? serviceName.trim() : undefined,
        description: description && description.trim() ? description.trim() : undefined,
        date: date ? new Date(date) : new Date(),
        _id: new mongoose.Types.ObjectId()
    };

    bike.maintenanceRecords.unshift(record);

    if (record.km && record.km > (bike.km || 0)) {
        bike.km = record.km;
    }

    await user.save({ validateBeforeSave: false });

    res.status(201).json({
        status: 'success',
        message: 'Bakım kaydı eklendi.',
        data: {
            record,
            bike,
            maintenanceRecords: bike.maintenanceRecords
        }
    });
});

export const deleteMaintenanceRecord = catchAsync(async (req, res, next) => {
    const { garageId, recordId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return next(new AppError('Motosiklet bulunamadı.', 404));

    if (bike.maintenanceRecords) {
        bike.maintenanceRecords = bike.maintenanceRecords.filter(
            r => r._id.toString() !== recordId
        );
    }

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Bakım kaydı silindi.',
        data: {
            bike,
            maintenanceRecords: bike.maintenanceRecords
        }
    });
});

// --- CART CONTROLLERS ---

export const getCart = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('cart');
    res.status(200).json({
        status: 'success',
        data: { cart: user.cart }
    });
});

export const addToCart = catchAsync(async (req, res, next) => {
    const { productId, name, price, image, quantity = 1 } = req.body;

    // Check if item exists
    const user = await User.findById(req.user.id);
    const existingItemIndex = user.cart.findIndex(item => item.productId === productId);

    if (existingItemIndex > -1) {
        // Update quantity
        user.cart[existingItemIndex].quantity += quantity;
    } else {
        // Add new
        user.cart.push({ productId, name, price, image, quantity });
    }

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        data: { cart: user.cart }
    });
});

export const removeFromCart = catchAsync(async (req, res, next) => {
    const { productId } = req.params;

    // Using pull to remove item
    const user = await User.findByIdAndUpdate(
        req.user.id,
        { $pull: { cart: { productId } } },
        { new: true }
    );

    res.status(200).json({
        status: 'success',
        data: { cart: user.cart }
    });
});

export const updateCartItem = catchAsync(async (req, res, next) => {
    const { productId } = req.params;
    const { quantity } = req.body;

    const user = await User.findById(req.user.id);
    const item = user.cart.find(item => item.productId === productId);

    if (item) {
        item.quantity = quantity;
        await user.save({ validateBeforeSave: false });
    }

    res.status(200).json({
        status: 'success',
        data: { cart: user.cart }
    });
});

// --- VERIFICATION CONTROLLERS ---

export const requestVerification = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id);

    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.verificationStatus === 'approved') {
        return next(new AppError('Zaten onaylı bir hesapsınız.', 400));
    }

    if (user.verificationStatus === 'pending') {
        return next(new AppError('Onay başvurunuz zaten inceleniyor.', 400));
    }

    user.verificationStatus = 'pending';
    // isVerified remains false
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Doğrulama başvurunuz alındı.',
        data: {
            verificationStatus: user.verificationStatus
        }
    });
});

export const updateVerificationStatus = catchAsync(async (req, res, next) => {
    // Only Admin
    if (!req.user.isAdmin) {
        return next(new AppError('Bu işlem için yetkiniz yok.', 403));
    }

    const { userId, status } = req.body; // status: 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return next(new AppError('Geçersiz durum.', 400));
    }

    const user = await User.findById(userId);
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    user.verificationStatus = status;
    user.isVerified = (status === 'approved');
    if (user.userType === 'PROFESSIONAL' && user.businessProfile) {
        user.businessProfile.verifiedBadge = status === 'approved';
        user.markModified('businessProfile');
    }

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: `Kullanıcı durumu ${status} olarak güncellendi.`,
        data: {
            userId: user._id,
            verificationStatus: user.verificationStatus,
            isVerified: user.isVerified
        }
    });
});

// --- BLOCKING ---

export const blockUser = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const currentUserId = req.user.id;

    if (id === currentUserId) {
        return next(new AppError('Kendinizi engelleyemezsiniz.', 400));
    }

    // Two-way relationship severing
    await Promise.all([
        User.findByIdAndUpdate(currentUserId, {
            $addToSet: { blockedUsers: id },
            $pull: { following: id, followers: id }
        }),
        User.findByIdAndUpdate(id, {
            $pull: { followers: currentUserId, following: currentUserId }
        })
    ]);

    try {
        await redis.del(`feed:discover:${currentUserId}`);
        await redis.del(`feed:discover:${id}`);
    } catch (_) { }

    res.status(200).json({
        status: 'success',
        message: 'Kullanıcı engellendi.'
    });
});

export const unblockUser = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    await User.findByIdAndUpdate(req.user.id, { $pull: { blockedUsers: id } });
    try {
        await redis.del(`feed:discover:${req.user.id}`);
    } catch (_) { }

    res.status(200).json({
        status: 'success',
        message: 'Engel kaldırıldı.'
    });
});

export const getBlockedUsers = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id)
        .select('blockedUsers')
        .populate({
            path: 'blockedUsers',
            select: '_id name username avatar isVerified rank bio coverImage'
        })
        .lean();

    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const blockedList = (user.blockedUsers || []).filter(u => u != null);

    res.status(200).json({
        status: 'success',
        results: blockedList.length,
        data: {
            users: blockedList
        }
    });
});



// --- ONBOARDING CONTROLLERS ---

export const onboardUser = catchAsync(async (req, res, next) => {
    const { nickname, phone, bike } = req.body;

    if (!nickname) {
        return next(new AppError('Lütfen bir kullanıcı adı girin.', 400));
    }

    const user = await User.findById(req.user.id).select('+tokenVersion');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    // Check username uniqueness
    const existingUsername = await User.findOne({ username: nickname, _id: { $ne: user._id } });
    if (existingUsername) {
        return next(new AppError('Bu kullanıcı adı zaten alınmış.', 400));
    }

    // Update user
    user.username = nickname;
    if (phone) user.phone = phone;
    user.onboardingComplete = true;

    // Add bike to garage if provided
    if (bike && bike.brand && bike.model) {
        const bikeData = {
            brand: bike.brand,
            model: bike.model,
            year: bike.year || new Date().getFullYear(),
            style: bike.style || 'NAKED'
        };
        user.garage.push(bikeData);
        user.primaryBike = `${bike.brand} ${bike.model}`;
    }

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);

    await createSendToken(user, 200, res);
});

export const sendPhoneOtp = catchAsync(async (req, res, next) => {
    const { phone } = req.body;
    if (typeof phone !== 'string' || !phone.trim()) {
        return next(new AppError('Telefon numarası zorunludur.', 400));
    }

    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (!/^\+?[1-9]\d{9,14}$/.test(cleanedPhone)) {
        return next(new AppError('Geçerli bir telefon numarası giriniz.', 400));
    }

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto
        .createHmac('sha256', getJwtSecret())
        .update(`${req.user.id}:${cleanedPhone}:${otpCode}`, 'utf8')
        .digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await PhoneOtp.findOneAndUpdate(
        { userId: req.user.id },
        {
            userId: req.user.id,
            phone: cleanedPhone,
            otpHash,
            attempts: 0,
            expiresAt,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const smsResult = await sendSMS({
        to: cleanedPhone,
        message: `MotoVibe telefon doğrulama kodunuz: ${otpCode}. Bu kod 10 dakika geçerlidir.`
    });

    const isProd = process.env.NODE_ENV === 'production';
    if (!smsResult.success && isProd) {
        await PhoneOtp.deleteOne({ userId: req.user.id, otpHash });
        return next(new AppError('Doğrulama kodu gönderilemedi. Lütfen tekrar deneyin.', 503));
    }

    res.status(200).json({
        status: 'success',
        message: 'Doğrulama kodu telefonunuza gönderildi.',
        phone: cleanedPhone,
        isMock: !isProd && smsResult.provider === 'NONE'
    });
});

export const verifyPhone = catchAsync(async (req, res, next) => {
    const { phone, otp } = req.body;

    if (typeof phone !== 'string' || !phone.trim()) {
        return next(new AppError('Telefon numarası zorunludur.', 400));
    }

    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    const cleanOtp = otp ? otp.toString().trim() : '';

    if (!/^\d{6}$/.test(cleanOtp)) {
        return next(new AppError('Geçerli bir doğrulama kodu (OTP) giriniz.', 400));
    }

    const otpRecord = await PhoneOtp.findOneAndUpdate({
        userId: req.user.id,
        phone: cleanedPhone,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: 5 },
    }, {
        $inc: { attempts: 1 },
    }, { new: true }).select('+otpHash +attempts');

    const submittedHash = crypto
        .createHmac('sha256', getJwtSecret())
        .update(`${req.user.id}:${cleanedPhone}:${cleanOtp}`, 'utf8')
        .digest('hex');
    const storedHash = otpRecord?.otpHash || '';
    const isValid = storedHash.length === submittedHash.length &&
        storedHash.length > 0 &&
        crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(submittedHash, 'hex'));

    if (!isValid) {
        if (otpRecord?.attempts >= 5) {
            await PhoneOtp.deleteOne({ _id: otpRecord._id });
        }
        return next(new AppError('Geçersiz veya süresi dolmuş doğrulama kodu.', 400));
    }

    await Promise.all([
        User.findByIdAndUpdate(req.user.id, {
            isPhoneVerified: true,
            phone: cleanedPhone,
        }),
        PhoneOtp.deleteOne({ _id: otpRecord._id }),
    ]);

    res.status(200).json({
        status: 'success',
        message: 'Telefon numarası başarıyla doğrulandı.',
        verified: true,
        phone: cleanedPhone,
    });
});

// ── PRO: Ghost Mode Toggle ────────────────────────────────────────────────

export const toggleGhostMode = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('isPro isGhostMode proExpiryDate isAdmin isPremium');

    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    // PRO / APEX kontrolü (Admin, Premium veya aktif Pro)
    if (!hasActiveApexAccess(user)) {
        return next(new AppError('Ghost Mode yalnızca MotoVibe PRO üyelerine açıktır.', 403));
    }

    // Toggle
    const newState = req.body.isGhostMode !== undefined
        ? Boolean(req.body.isGhostMode)
        : !user.isGhostMode;

    user.isGhostMode = newState;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        data: { isGhostMode: user.isGhostMode },
        message: user.isGhostMode ? '👻 Ghost Mode aktif — Radar sessizliği başladı.' : 'Ghost Mode kapatıldı.'
    });
});


// ── COCKPIT ILLUMINATION: Theme Preference ──────────────────────────────────

const ALLOWED_ACCENT_COLORS = [
    '#E2FF3B', // Neon Lime (Default)
    '#CC0000', // Rosso Red (Ducati)
    '#0033CC', // Racing Blue (Yamaha)
    '#66FF00', // Ninja Green (Kawasaki)
    '#FF6600', // Ready Orange (KTM)
    '#E0E0E0', // Stealth Silver (Minimalist)
    '#D34599', // Magenta Rush (Vibe)
    '#F104BD', // Electric Pink (Pop)
    '#F3CB0C', // Gold Rush (Apex)
    '#0B9089', // Deep Teal (Ocean)
    '#8A0526', // Ruby Wine (Classic)
    '#F0028B', // Hot Neon (Street)
    '#91C7AF', // Sage Mint (Modern)
];

export const updateThemePreference = catchAsync(async (req, res, next) => {
    const { accentColor } = req.body;

    if (!accentColor) {
        return next(new AppError('Accent rengi belirtilmedi.', 400));
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(accentColor)) {
        return next(new AppError('Gecerli bir hex renk formati giriniz.', 400));
    }

    if (!ALLOWED_ACCENT_COLORS.includes(accentColor.toUpperCase())) {
        return next(new AppError('Bu renk Moto-Palette listesinde mevcut degil.', 400));
    }

    const user = await User.findById(req.user.id).select('isPro proExpiryDate preferences');
    if (!user) return next(new AppError('Kullanici bulunamadi.', 404));

    const freeColors = ['#E2FF3B', '#CC0000'];
    if (!freeColors.includes(accentColor.toUpperCase())) {
        const isPro = user.isPro && (!user.proExpiryDate || user.proExpiryDate > new Date());
        if (!isPro) {
            return res.status(403).json({
                status: 'fail',
                message: 'Kokpit Aydinlatmasi ozelligi sadece APEX Suruculeri icin gecerlidir.',
                requiresApex: true
            });
        }
    }

    if (!user.preferences) user.preferences = {};
    user.preferences.accentColor = accentColor.toUpperCase();
    user.markModified('preferences');
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        data: { accentColor: user.preferences.accentColor },
        message: 'Kokpit aydinlatmasi guncellendi.'
    });
});

// -- RIDE TELEMETRY: Save post-ride stats --

export const saveTelemetry = catchAsync(async (req, res, next) => {
    const { distanceKm, topSpeed, maxLeanAngle, city, cityName } = req.body;

    const safeDistance = Number(distanceKm) || 0;
    const safeTopSpeed = Number(topSpeed) || 0;
    const safeMaxLean = Number(maxLeanAngle) || 0;

    if (safeDistance < 0 || safeTopSpeed < 0 || safeMaxLean < 0) {
        return next(new AppError('Telemetri degerleri negatif olamaz.', 400));
    }

    // Makul sürüş sınırları (Tek sürüş için maks 300 km, maks hız 299 km/s, maks yatış açısı 65 derece)
    if (safeDistance > 300 || safeTopSpeed > 299 || safeMaxLean > 65) {
        return next(new AppError('Telemetri değerleri makul sürüş sınırlarının dışında (Maks 300 km / 299 km/s / 65°).', 400));
    }

    const updateQuery = {
        $inc: { totalKm: Math.round(safeDistance * 10) / 10 }
    };

    const user = await User.findById(req.user.id).select('topSpeed totalKm achievementProgress');
    if (!user) return next(new AppError('Kullanici bulunamadi.', 404));

    if (safeTopSpeed > (user.topSpeed || 0)) {
        updateQuery.$set = { topSpeed: Math.round(safeTopSpeed) };
    }

    const updatedUser = await User.findByIdAndUpdate(req.user.id, updateQuery, { new: true })
        .select('totalKm topSpeed');

    if (safeMaxLean > 0) {
        await setMaxMetric(req.user.id, 'maxLeanAngle', safeMaxLean);
    }

    const targetCity = (city || cityName || '').toString().trim();
    if (targetCity) {
        await recordVisitedCity(req.user.id, targetCity);
    }

    evaluateAndUnlock(req.user.id).catch(err => console.error('[Telemetry] evaluateAndUnlock error:', err));

    res.status(200).json({
        status: 'success',
        data: {
            totalKm: updatedUser.totalKm,
            topSpeed: updatedUser.topSpeed
        }
    });
});


export const checkUsernameAvailability = catchAsync(async (req, res, next) => {
    const { username } = req.body;
    if (!username) return next(new AppError('Kullanıcı adı belirtilmedi.', 400));

    const cleanUsername = username.toLowerCase().trim();
    const usernameRegex = /^[a-z0-9_]{3,20}$/;
    
    if (!usernameRegex.test(cleanUsername)) {
        return res.status(200).json({
            status: 'success',
            isAvailable: false,
            message: 'Kullanıcı adı sadece küçük harf, rakam ve alt çizgi (_) içerebilir (3-20 karakter).'
        });
    }

    if (isReservedUsername(cleanUsername) && (!req.user || !req.user.isAdmin)) {
        return res.status(200).json({
            status: 'success',
            isAvailable: false,
            message: 'Bu kullanıcı adı marka/sistem politikası gereği rezerve edilmiştir.'
        });
    }

    const existingUser = await User.findOne({ username: cleanUsername });
    res.status(200).json({
        status: 'success',
        isAvailable: !existingUser || (req.user && existingUser._id.toString() === req.user.id),
        username: cleanUsername
    });
});

// --- MOTOVIBE BİZ (PRO) CONTROLLERS ---
export const upgradeToPro = catchAsync(async (req, res, next) => {
    const { category, services, addressCoordinates, taxId } = req.body;

    if (!category) {
        return next(new AppError('Lütfen işletme kategorisi seçiniz.', 400));
    }

    if (!taxId || String(taxId).trim().length === 0) {
        return next(new AppError('Vergi levhası / TC Kimlik no zorunludur.', 400));
    }

    if (!BUSINESS_CATEGORIES.includes(category)) {
        return next(new AppError('Geçersiz isletme kategorisi.', 400));
    }

    if (services !== undefined && !Array.isArray(services)) {
        return next(new AppError('Hizmet listesi dizi formatinda olmalidir.', 400));
    }

    if (addressCoordinates !== undefined && !isValidBusinessCoordinates(addressCoordinates)) {
        return next(new AppError('Konum koordinatlari geçersiz.', 400));
    }

    const user = await User.findById(req.user.id);
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const normalizedServices = normalizeBusinessServices(services || []);
    const normalizedTaxId = String(taxId || '').trim();
    if (!isValidTurkishTaxIdentifier(normalizedTaxId)) {
        return next(new AppError('Vergi numarası 10 haneli VKN veya 11 haneli TCKN olmalıdır.', 400));
    }

    if (user.userType === 'PROFESSIONAL') {
        if (!user.isVerified) {
            user.verificationStatus = 'pending';
        }
        if (!user.businessProfile) {
            user.businessProfile = {};
        }
        user.businessProfile.category = user.businessProfile.category || category;
        if (!Array.isArray(user.businessProfile.services) || user.businessProfile.services.length === 0) {
            user.businessProfile.services = normalizedServices;
        }
        if (!Array.isArray(user.businessProfile.catalogItems)) {
            user.businessProfile.catalogItems = [];
        }
        user.businessProfile.verifiedBadge = user.businessProfile.verifiedBadge === true;
        user.businessProfile.workingHours = user.businessProfile.workingHours || [];
        user.activeProfileMode = user.activeProfileMode || 'PROFESSIONAL';
        user.markModified('businessProfile');
        await user.save({ validateBeforeSave: false });

        return res.status(200).json({
            status: 'success',
            message: 'Profesyonel hesap zaten aktif.',
            data: {
                user: buildBusinessUserPayload(user)
            }
        });
    }

    // Update to PRO
    user.userType = 'PROFESSIONAL';
    user.activeProfileMode = 'PROFESSIONAL';
    user.businessProfile = {
        category,
        services: normalizedServices,
        catalogItems: [],
        verifiedBadge: false,
        workingHours: [],
        address: addressCoordinates ? {
            type: 'Point',
            coordinates: [Number(addressCoordinates[0]), Number(addressCoordinates[1])]
        } : undefined,
        taxId: normalizedTaxId || undefined
    };
    if (!user.isVerified) {
        user.verificationStatus = 'pending';
    }
    
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Profesyonel hesaba gecis tamamlandi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    });
});

const PRO_OFFERS = [
    {
        id: 'pro_monthly',
        period: 'monthly',
        price: 149.99,
        title: 'Aylik Plan',
        subtitle: 'Esnek baslangic, istedigin zaman degistir.',
        formattedPrice: '149.99 TL',
        isBestValue: false
    },
    {
        id: 'pro_yearly',
        period: 'yearly',
        price: 1199.99,
        title: 'Yillik Plan',
        subtitle: 'Apex suruculerinin en cok sectigi plan.',
        formattedPrice: '1199.99 TL',
        isBestValue: true
    },
    {
        id: 'pro_lifetime',
        period: 'lifetime',
        price: 3499.99,
        title: 'Lifetime',
        subtitle: 'Tek odeme ile kalici PRO erisimi.',
        formattedPrice: '3499.99 TL',
        isBestValue: false
    }
];

export const getProOffers = catchAsync(async (req, res, next) => {
    res.status(200).json({
        status: 'success',
        data: { offerings: PRO_OFFERS }
    });
});

export const subscribeToPro = catchAsync(async (req, res, next) => {
    return next(new AppError(
        'Doğrudan PRO aktivasyonu kapalıdır. Satın alma App Store veya Google Play üzerinden doğrulanmalıdır.',
        503
    ));
});

export const restoreProSubscription = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('isPro isPremium proExpiryDate');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const now = new Date();
    const active = hasActiveApexAccess(user, now);
    if (!active && (user.isPro || user.isPremium)) {
        user.isPro = false;
        user.isPremium = false;
        await user.save({ validateBeforeSave: false });
    }

    res.status(200).json({
        status: 'success',
        data: {
            isPro: active,
            proExpiryDate: user.proExpiryDate || null
        },
        message: active ? 'PRO üyeliği geri yuklendi.' : 'Aktif PRO üyeliği bulunamadı.'
    });
});

export const updateBusinessProfile = catchAsync(async (req, res, next) => {
    const { category, services, taxId, workingHours, addressCoordinates, addressLabel, businessName, businessDescription, businessPhone, businessSocials, acceptsAppointments } = req.body || {};

    const user = await User.findById(req.user.id).select('userType activeProfileMode businessProfile isPro isVerified verificationStatus');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) {
        user.businessProfile = {};
    }

    if (category !== undefined) {
        if (!BUSINESS_CATEGORIES.includes(category)) {
            return next(new AppError('Geçersiz isletme kategorisi.', 400));
        }
        user.businessProfile.category = category;
    }

    if (businessName !== undefined) {
        const trimmed = String(businessName || '').trim();
        if (trimmed.length > 80) {
            return next(new AppError('Isletme adi cok uzun (max 80 karakter).', 400));
        }
        user.businessProfile.businessName = trimmed || undefined;
    }

    if (businessDescription !== undefined) {
        const trimmed = String(businessDescription || '').trim();
        if (trimmed.length > 300) {
            return next(new AppError('Isletme aciklamasi cok uzun (max 300 karakter).', 400));
        }
        user.businessProfile.businessDescription = trimmed || undefined;
    }

    if (businessPhone !== undefined) {
        const trimmed = String(businessPhone || '').trim();
        if (trimmed.length > 20) {
            return next(new AppError('Telefon numarasi cok uzun.', 400));
        }
        user.businessProfile.businessPhone = trimmed || undefined;
    }

    if (businessSocials !== undefined && typeof businessSocials === 'object') {
        if (!user.businessProfile.businessSocials) {
            user.businessProfile.businessSocials = {};
        }
        if (businessSocials.instagram !== undefined) {
            user.businessProfile.businessSocials.instagram = String(businessSocials.instagram || '').trim().slice(0, 100);
        }
        if (businessSocials.website !== undefined) {
            user.businessProfile.businessSocials.website = String(businessSocials.website || '').trim().slice(0, 200);
        }
        if (businessSocials.whatsapp !== undefined) {
            user.businessProfile.businessSocials.whatsapp = String(businessSocials.whatsapp || '').trim().slice(0, 20);
        }
    }

    if (taxId !== undefined) {
        const normalizedTaxId = String(taxId || '').trim();
        if (normalizedTaxId && !isValidTurkishTaxIdentifier(normalizedTaxId)) {
            return next(new AppError('Vergi numarası 10 haneli VKN veya 11 haneli TCKN olmalıdır.', 400));
        }
        const previousTaxId = String(user.businessProfile.taxId || '');
        if (previousTaxId !== normalizedTaxId) {
            user.businessProfile.taxId = normalizedTaxId || undefined;
            user.businessProfile.verifiedBadge = false;
            user.verificationStatus = normalizedTaxId ? 'pending' : 'none';
            await recordBusinessAudit({
                businessId: user._id,
                actorId: req.user.id,
                action: 'TAX_ID_UPDATED',
                metadata: {
                    maskedSuffix: normalizedTaxId.slice(-2),
                    source: 'business_profile',
                    verificationReset: true
                }
            });
        }
    }

    if (services !== undefined) {
        if (!Array.isArray(services)) {
            return next(new AppError('Hizmet listesi dizi formatinda olmalidir.', 400));
        }
        user.businessProfile.services = normalizeBusinessServices(services);
    }

    if (acceptsAppointments !== undefined) {
        if (typeof acceptsAppointments !== 'boolean') {
            return next(new AppError('Randevu tercihi geçersiz.', 400));
        }
        user.businessProfile.acceptsAppointments = acceptsAppointments;
    }

    if (workingHours !== undefined) {
        const normalizedHours = normalizeBusinessWorkingHours(workingHours);
        if (normalizedHours.error) return next(new AppError(normalizedHours.error, 400));
        user.businessProfile.workingHours = normalizedHours.value;
    }

    if (addressCoordinates !== undefined) {
        if (!isValidBusinessCoordinates(addressCoordinates)) {
            return next(new AppError('Konum koordinatlari geçersiz.', 400));
        }
        user.businessProfile.address = {
            type: 'Point',
            coordinates: [Number(addressCoordinates[0]), Number(addressCoordinates[1])],
            label: user.businessProfile.address?.label
        };
    }
    if (addressLabel !== undefined) {
        const normalizedLabel = String(addressLabel || '').trim();
        if (normalizedLabel.length > 160) {
            return next(new AppError('Adres etiketi çok uzun.', 400));
        }
        if (!user.businessProfile.address?.coordinates || user.businessProfile.address.coordinates.length !== 2) {
            return next(new AppError('Adres etiketi için önce geçerli konum koordinatları ekleyin.', 400));
        }
        user.businessProfile.address.label = normalizedLabel || undefined;
    }

    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Isletme profili guncellendi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    });
});

export const getBusinessCatalog = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    const items = Array.isArray(user.businessProfile?.catalogItems)
        ? user.businessProfile.catalogItems
        : [];

    res.status(200).json({
        status: 'success',
        results: items.length,
        data: { items }
    });
});

export const updateBusinessCatalog = catchAsync(async (req, res, next) => {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
        return next(new AppError('Katalog listesi dizi formatinda olmalidir.', 400));
    }

    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }


    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Isletme profili guncellendi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    });
});



export const getBusinessTaxId = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id)
        .select('userType +businessProfile.taxId');
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Vergi bilgisi için BİZ hesabı gerekir.', 403));
    }

    const rawTaxId = user.businessProfile?.taxId;
    await recordBusinessAudit({
        businessId: user._id,
        actorId: req.user.id,
        action: 'TAX_ID_ACCESSED',
        metadata: {
            source: 'business_profile_owner',
            hasValue: Boolean(rawTaxId)
        }
    });

    res.status(200).json({
        status: 'success',
        data: { maskedTaxId: maskTaxIdentifier(rawTaxId) }
    });
});

export const registerPushToken = catchAsync(async (req, res, next) => {
    const token = String(req.body?.token || '').trim();
    const platform = ['android', 'ios', 'web'].includes(req.body?.platform)
        ? req.body.platform
        : 'unknown';
    if (!token || token.length > 512) {
        return next(new AppError('Geçerli bir bildirim tokenı gönderilmelidir.', 400));
    }
    const user = await User.findById(req.user.id).select('pushTokens');
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));
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
    res.status(200).json({ status: 'success' });
});

export const unregisterPushToken = catchAsync(async (req, res, next) => {
    const token = String(req.body?.token || '').trim();
    if (!token) return next(new AppError('Bildirim tokenı zorunludur.', 400));
    await User.updateOne({ _id: req.user.id }, { $pull: { pushTokens: { token } } });
    res.status(200).json({ status: 'success' });
});

export const createBusinessCatalogItem = catchAsync(async (req, res, next) => {
    const parsed = buildBusinessCatalogItemInput(req.body || {});
    if (parsed.error) return next(new AppError(parsed.error, 400));

    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu işlem için profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) user.businessProfile = {};
    const catalogItems = Array.isArray(user.businessProfile.catalogItems)
        ? user.businessProfile.catalogItems
        : [];
    if (catalogItems.length >= 120) {
        return next(new AppError('Katalog en fazla 120 ürün içerebilir.', 400));
    }

    const normalizedName = parsed.value.name.toLocaleLowerCase('tr-TR');
    const duplicate = catalogItems.some(
        (item) => String(item.name || '').trim().toLocaleLowerCase('tr-TR') === normalizedName
    );
    if (duplicate) {
        return next(new AppError('Bu isimde bir ürün katalogda zaten var.', 409));
    }

    user.businessProfile.catalogItems.push(parsed.value);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    const item = user.businessProfile.catalogItems[user.businessProfile.catalogItems.length - 1];
    res.status(201).json({
        status: 'success',
        message: 'Ürün eklendi.',
        data: { item, items: user.businessProfile.catalogItems }
    });
});

export const updateBusinessCatalogItem = catchAsync(async (req, res, next) => {
    const itemId = String(req.params.itemId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
        return next(new AppError('Geçersiz ürün kimliği.', 400));
    }

    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu işlem için profesyonel hesap gerekir.', 403));
    }

    const catalogItems = Array.isArray(user.businessProfile?.catalogItems)
        ? user.businessProfile.catalogItems
        : [];
    const itemIndex = catalogItems.findIndex((item) => String(item._id) === itemId);
    if (itemIndex < 0) return next(new AppError('Ürün bulunamadı.', 404));

    const currentItem = catalogItems[itemIndex].toObject
        ? catalogItems[itemIndex].toObject()
        : catalogItems[itemIndex];
    const parsed = buildBusinessCatalogItemInput({ ...currentItem, ...(req.body || {}) });
    if (parsed.error) return next(new AppError(parsed.error, 400));

    const normalizedName = parsed.value.name.toLocaleLowerCase('tr-TR');
    const duplicate = catalogItems.some((item, index) =>
        index !== itemIndex && String(item.name || '').trim().toLocaleLowerCase('tr-TR') === normalizedName
    );
    if (duplicate) {
        return next(new AppError('Bu isimde bir ürün katalogda zaten var.', 409));
    }

    catalogItems[itemIndex].set(parsed.value);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Ürün güncellendi.',
        data: { item: user.businessProfile.catalogItems[itemIndex], items: user.businessProfile.catalogItems }
    });
});

export const deleteBusinessCatalogItem = catchAsync(async (req, res, next) => {
    const itemId = String(req.params.itemId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
        return next(new AppError('Geçersiz ürün kimliği.', 400));
    }

    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu işlem için profesyonel hesap gerekir.', 403));
    }

    const catalogItems = Array.isArray(user.businessProfile?.catalogItems)
        ? user.businessProfile.catalogItems
        : [];
    const itemIndex = catalogItems.findIndex((item) => String(item._id) === itemId);
    if (itemIndex < 0) return next(new AppError('Ürün bulunamadı.', 404));

    catalogItems.splice(itemIndex, 1);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Ürün silindi.',
        data: { items: user.businessProfile.catalogItems }
    });
});
export const getBusinessFlashOffers = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    const activeOnly = String(req.query.activeOnly || 'true') !== 'false';
    const offers = sanitizeBusinessFlashOffers(user.businessProfile?.flashOffers || []);
    const now = Date.now();
    const visible = activeOnly
        ? offers.filter((offer) => offer.isActive === true && new Date(offer.validUntil).getTime() > now)
        : offers;

    res.status(200).json({
        status: 'success',
        results: visible.length,
        data: { offers: visible }
    });
});

export const getNearbyBusinessFlashOffers = catchAsync(async (req, res, next) => {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    const radiusKm = req.query.radius === undefined ? 30 : Number(req.query.radius);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return next(new AppError('Geçerli enlem ve boylam gönderilmelidir.', 400));
    }
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 300) {
        return next(new AppError('Yarıçap 1 ile 300 km arasında olmalıdır.', 400));
    }

    const businesses = await User.find({
        userType: 'PROFESSIONAL',
        activeProfileMode: 'PROFESSIONAL',
        'businessProfile.address': {
            $near: {
                $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                $maxDistance: Math.round(radiusKm * 1000)
            }
        },
        'businessProfile.flashOffers': {
            $elemMatch: { isActive: true, validUntil: { $gt: new Date() } }
        }
    })
        .select('_id name username avatar isVerified businessProfile')
        .limit(60)
        .lean();

    const toRadians = (value) => value * Math.PI / 180;
    const distanceKm = (coordinates) => {
        const [targetLng, targetLat] = coordinates;
        const dLat = toRadians(targetLat - latitude);
        const dLng = toRadians(targetLng - longitude);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(latitude)) * Math.cos(toRadians(targetLat)) * Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const offers = businesses.flatMap((business) => {
        const profile = businessProfileForPublic(business.businessProfile);
        const coordinates = profile?.address?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
        const distance = distanceKm(coordinates);
        return (profile.flashOffers || [])
            .filter((offer) => offer.targetRadiusKm >= distance)
            .map((offer) => ({
                offer,
                distanceKm: Number(distance.toFixed(1)),
                business: {
                    _id: business._id,
                    name: business.name,
                    username: business.username,
                    avatar: business.avatar,
                    isVerified: business.isVerified,
                    businessProfile: profile
                }
            }));
    }).sort((a, b) => a.distanceKm - b.distanceKm);

    res.status(200).json({
        status: 'success',
        results: offers.length,
        data: { offers }
    });
});

export const createBusinessFlashOffer = catchAsync(async (req, res, next) => {
    const parsed = buildBusinessFlashOfferInput(req.body || {});
    if (parsed.error) {
        return next(new AppError(parsed.error, 400));
    }

    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) {
        user.businessProfile = {};
    }

    const normalizedOffers = sanitizeBusinessFlashOffers(user.businessProfile.flashOffers || []);
    const now = Date.now();
    const activeCount = normalizedOffers.filter(
        (offer) => offer.isActive === true && new Date(offer.validUntil).getTime() > now
    ).length;
    if (activeCount >= 1) {
        return next(new AppError('Aynı anda yalnızca 1 aktif flash kampanya yayınlayabilirsiniz.', 400));
    }

    const nextOffers = [parsed.value, ...normalizedOffers];
    user.businessProfile.flashOffers = sanitizeBusinessFlashOffers(nextOffers);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    res.status(201).json({
        status: 'success',
        message: 'Flash kampanya yayinlandi.',
        data: {
            offer: parsed.value,
            offers: user.businessProfile.flashOffers
        }
    });
});

export const cancelBusinessFlashOffer = catchAsync(async (req, res, next) => {
    const offerId = String(req.params.offerId || '').trim();
    if (!offerId) {
        return next(new AppError('Geçersiz kampanya kimligi.', 400));
    }

    const user = await User.findById(req.user.id).select('userType businessProfile');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) {
        return next(new AppError('Aktif isletme profili bulunamadı.', 404));
    }

    const offers = sanitizeBusinessFlashOffers(user.businessProfile.flashOffers || []);
    const index = offers.findIndex((offer) => String(offer.offerId) === offerId);
    if (index < 0) {
        return next(new AppError('Kampanya bulunamadı.', 404));
    }

    offers[index] = {
        ...offers[index],
        isActive: false,
        validUntil: new Date()
    };

    user.businessProfile.flashOffers = sanitizeBusinessFlashOffers(offers);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
        status: 'success',
        message: 'Flash kampanya kapatildi.',
        data: { offer: offers[index], offers: user.businessProfile.flashOffers }
    });
});

export const downgradeFromPro = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('userType activeProfileMode businessProfile isPro isVerified verificationStatus');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return next(new AppError('Zaten bireysel hesap kullaniyorsunuz.', 400));
    }

    const openAppointments = await Appointment.find({
        businessId: user._id,
        status: { $in: ['pending', 'approved', 'inProgress'] }
    }).select('_id customerId');
    if (openAppointments.length > 0) {
        await Appointment.updateMany(
            { _id: { $in: openAppointments.map((appointment) => appointment._id) } },
            { $set: { status: 'cancelled' } }
        );
        await Promise.allSettled(
            openAppointments.map((appointment) => createNotification({
                recipient: appointment.customerId,
                sender: user._id,
                type: 'APPOINTMENT_UPDATE',
                appointment: appointment._id
            }))
        );
    }

    user.userType = 'INDIVIDUAL';
    user.activeProfileMode = 'PERSONAL';
    user.businessProfile = undefined;
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });
    normalizeProfessionalStatusForResponse(user);

    res.status(200).json({
        status: 'success',
        message: 'Profesyonel hesap kapatildi. Bireysel profil aktif.',
        data: {
            user: buildBusinessUserPayload(user),
            cancelledAppointments: openAppointments.length
        }
    });
});

// Product-language aliases. Legacy Pro routes remain available for old clients.
export const upgradeToBusiness = upgradeToPro;
export const downgradeFromBusiness = downgradeFromPro;

export const calculateFuelEfficiency = catchAsync(async (req, res, next) => {
    const { expenses } = req.body;
    
    if (!expenses || !Array.isArray(expenses)) {
        return next(new AppError('Geçersiz gider verisi.', 400));
    }

    const fuelLogs = expenses
        .filter(e => e.type === 'FUEL')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (fuelLogs.length < 2) {
        return res.status(400).json({ message: "Hesaplama için en az iki yakıt alımı gereklidir." });
    }

    const lastFuel = fuelLogs[fuelLogs.length - 2];
    const currentFuel = fuelLogs[fuelLogs.length - 1];
    const odoDifference = currentFuel.odometer - lastFuel.odometer;
    
    if (odoDifference <= 0) {
        return res.status(400).json({ message: "Geçersiz kilometre verisi algılandı." });
    }

    const efficiency = (currentFuel.liters / odoDifference) * 100;

    res.status(200).json({
        status: 'success',
        data: {
            efficiencyPer100km: efficiency.toFixed(2),
            month: new Date(currentFuel.date).getMonth() + 1
        }
    });
});


// ─── ACHIEVEMENTS ────────────────────────────────────────────────────────────

export const seedAchievements = catchAsync(async (req, res, next) => {
    // Sadece admin yetkisi ile çalıştırılabilir
    await ensureDefaultAchievements();
    
    res.status(200).json({
        status: 'success',
        message: 'Achievements seeded successfully'
    });
});

export const getAllAchievements = catchAsync(async (req, res, next) => {
    // Normal kullanıcılar kendi başarımlarını veya profilini inceledikleri diğer sürücülerin başarımlarını görüntüleyebilir
    const targetUserId = req.query.userId || req.user?.id;
    if (!targetUserId) return next(new AppError('Kullanıcı kimliği belirtilmedi.', 400));
    
    // Eğer kendi başarımlarını görüntülüyorsa anlık değerlendir ve yeni kilit açılışlarını yakala
    if (req.user?.id && targetUserId.toString() === req.user.id.toString()) {
        await evaluateAndUnlock(targetUserId);
    }

    const user = await User.findById(targetUserId).select('points totalKm topSpeed maxLeanAngle achievementProgress unlockedAchievements rank followers following visitedCities name username');
    if (!user) return next(new AppError('Kullanıcı bulunamadı.', 404));

    let achievements = await Achievement.find().sort({ requiredValue: 1 }).lean();
    if (!achievements || achievements.length === 0) {
        await ensureDefaultAchievements();
        achievements = await Achievement.find().sort({ requiredValue: 1 }).lean();
    }

    const getProgress = (key) => {
        if (!user.achievementProgress) return 0;
        if (typeof user.achievementProgress.get === 'function') {
            return user.achievementProgress.get(key) || 0;
        }
        return user.achievementProgress[key] || 0;
    };

    const followersCount = Array.isArray(user.followers) ? user.followers.length : (Number(user.followers) || 0);
    const followingCount = Array.isArray(user.following) ? user.following.length : (Number(user.following) || 0);
    const dynamicFollowGraph = followersCount + followingCount;

    const unlockedSet = new Set((user.unlockedAchievements || []).map(id => id.toString()));
    const processedAchievements = [];

    let totalPointsReward = 0;

    for (const ach of achievements) {
        let currentValue = 0;
        
        switch (ach.metric) {
            case 'points':
                currentValue = user.points || 0;
                break;
            case 'totalKm':
                currentValue = user.totalKm || 0;
                break;
            case 'topSpeed':
                currentValue = user.topSpeed || 0;
                break;
            case 'maxLeanAngle':
                currentValue = Math.max(user.maxLeanAngle || 0, getProgress('maxLeanAngle'));
                break;
            case 'nightRides':
                currentValue = getProgress('nightRides');
                break;
            case 'packLeads':
                currentValue = getProgress('packLeads');
                break;
            case 'eventsCreated':
                currentValue = getProgress('eventsCreated');
                break;
            case 'followGraph':
                currentValue = Math.max(dynamicFollowGraph, getProgress('followGraph'));
                break;
            case 'uniqueCities':
                currentValue = Math.max((user.visitedCities || []).length, getProgress('uniqueCities'));
                break;
            default:
                currentValue = getProgress(ach.metric);
                break;
        }

        const isUnlocked = unlockedSet.has(ach._id.toString()) || (ach.requiredValue > 0 && currentValue >= ach.requiredValue);
        const progress = ach.requiredValue > 0 ? Math.min(100, Math.round((currentValue / ach.requiredValue) * 100)) : 0;
        const pointsReward = ach.pointsReward || (ach.badgeType === 'Gold' ? 250 : ach.badgeType === 'Neon' ? 100 : 50);

        if (isUnlocked) {
            totalPointsReward += pointsReward;
        }

        processedAchievements.push({
            id: ach._id,
            slug: ach.slug,
            title: ach.title,
            description: ach.description,
            category: ach.category,
            badgeType: ach.badgeType,
            requiredValue: ach.requiredValue,
            unit: ach.unit || '',
            metric: ach.metric,
            pointsReward,
            currentValue,
            progress,
            isUnlocked
        });
    }

    const rankData = calculateRankAndLevel(user.points || 0);
    const unlockedCount = processedAchievements.filter(a => a.isUnlocked).length;
    const totalCount = processedAchievements.length;
    const completionRate = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

    res.status(200).json({
        status: 'success',
        data: {
            achievements: processedAchievements,
            points: rankData.points,
            rank: rankData.rank,
            level: rankData.level,
            unlockedCount,
            totalCount,
            completionRate,
            totalPointsReward
        }
    });
});

export const deleteMyAccount = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('+tokenVersion +refreshSessions');
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    user.isDeleted = true;
    user.deletedAt = new Date();
    user.pushTokens = [];
    user.refreshSessions = [];
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    user.resetPasswordOTPHash = undefined;
    user.resetPasswordNonce = undefined;
    user.resetPasswordAttempts = 0;
    user.resetPasswordExpires = undefined;
    user.email = `deleted_${user._id}_${user.email}`;
    if (user.username) {
        user.username = `deleted_${user._id}_${user.username}`;
    }
    await user.save({ validateBeforeSave: false });
    disconnectUserSessions(user._id);

    // İçerikleri gizle, mesaj ve yorumları temizle, takip grafiğini sıfırla
    try {
        await Promise.allSettled([
            Post.updateMany(
                { user: user._id },
                { $set: { isDeleted: true, visibility: 'DELETED' } }
            ),
            Reel.updateMany(
                { userId: { $in: [user._id.toString(), user._id] } },
                { $set: { isDeleted: true } }
            ),
            Comment.deleteMany({ author: user._id }),
            ReelComment.deleteMany({ author: user._id }),
            PackPost.updateMany(
                { 'comments.author': user._id },
                { $pull: { comments: { author: user._id } } }
            ),
            Message.deleteMany({ sender: user._id }),
            PackLoungeMessage.deleteMany({ sender: user._id }),
            Conversation.updateMany(
                { participants: user._id },
                { $pull: { participants: user._id } }
            ),
            User.updateMany(
                { followers: user._id },
                { $pull: { followers: user._id } }
            ),
            User.updateMany(
                { following: user._id },
                { $pull: { following: user._id } }
            )
        ]);
    } catch (cleanErr) {
        console.warn('deleteMyAccount cleanup warning:', cleanErr);
    }

    res.status(200).json({
        status: 'success',
        message: 'Hesabınız ve kişisel verileriniz başarıyla silindi.'
    });
});
