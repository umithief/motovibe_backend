import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';
import { raiseHttpError } from '../../utils/httpError.js';


import mongoose from 'mongoose';
import User from "./model.js";
import Post from "../posts/model.js";
import Route from "../routes/model.js";

import AppError from "../../utils/appError.js";
import { recalculatePacksForUser, refreshPackGlobalRanks } from "../packs/service.js";
import { isReservedUsername } from "../../utils/reservedUsernames.js";
import { hasActiveApexAccess } from "../../utils/apexAccess.js";
import { addProfileThemeResponse } from "../../utils/profileThemes.js";
import { evaluateAndUnlock, ensureDefaultAchievements, calculateRankAndLevel, incrementMetric, setMaxMetric, recordVisitedCity } from "../achievements/service.js";
import { normalizeProfessionalStatusForResponse, businessProfileForPublic } from './business.service.js';
import { userLookupQuery, resolveViewerAccess, stripPublicUserFields } from './privacy.service.js';
import { validateAndSanitizeBioBlocks } from './bio.service.js';
import { createSessionResult, ALLOWED_ACCENT_COLORS } from './service.js';

export const getMe = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    // PERFORMANCE FIX: Two parallel queries — light user data + counts via aggregation
    const userId = new mongoose.Types.ObjectId(input.user.id);
    const [user, counts, posts, totalPosts] = await Promise.all([
        User.findById(input.user.id)
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
        return throwError(new AppError('Kullanıcı bulunamadı', 404));
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
    addProfileThemeResponse(user);

    respond({
        status: 'success',
        data: {
            user
        }
    },200);

    return response;
};

export const getProfile = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findOne(userLookupQuery(input.params.id))
        .select('-password -interestVector -spotifyRefreshToken -cart -savedPosts -savedRoutes')
        .lean();

    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, input);
    if (access.blocked) {
        return throwError(new AppError('Bu kullanıcıya erişilemiyor.', 403));
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
    addProfileThemeResponse(userObj);
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

    respond({
        status: 'success',
        data: {
            user: userObj,
            isFollowing,
            isLocked
        }
    },200);

    return response;
};

export const getUsersByIds = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { userIds } = input.body || {};

    if (!Array.isArray(userIds)) {
        return throwError(new AppError('Kullanıcı listesi geçersiz.', 400));
    }

    if (userIds.length > 200) {
        return throwError(new AppError('Tek istekte en fazla 200 kullanıcı getirilebilir.', 400));
    }

    const normalizedIds = [...new Set(
        userIds
            .map((id) => String(id).trim())
            .filter((id) => mongoose.isValidObjectId(id))
    )];

    if (normalizedIds.length === 0) {
        return respond({
            status: 'success',
            results: 0,
            data: { users: [] }
        },200);
    }

    const users = await User.find({ _id: { $in: normalizedIds } })
        .select('_id name username avatar isVerified rank userType activeProfileMode businessProfile')
        .lean();

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const orderedUsers = normalizedIds
        .map((id) => usersById.get(id))
        .filter(Boolean);

    respond({
        status: 'success',
        results: orderedUsers.length,
        data: { users: orderedUsers }
    },200);

    return response;
};

export const getUserBio = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findOne(userLookupQuery(input.params.id))
        .select('bioBlocks followers privacy blockedUsers')
        .lean();
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, input);
    if (access.blocked) {
        return throwError(new AppError('Bu kullanıcıya erişilemiyor.', 403));
    }
    if (access.isLocked) {
        return respond({
            status: 'success',
            bioBlocks: [],
            isLocked: true
        },200);
    }

    respond({
        status: 'success',
        bioBlocks: user.bioBlocks || [],
        isLocked: false
    },200);

    return response;
};

export const updateProfile = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    // 1) Create error if user POSTs password data
    if (input.body.password || input.body.passwordConfirm) {
        return throwError(new AppError('Bu rota üzerinden şifre güncellenemez.', 400));
    }

    // Alias desteği
    if (input.body.displayName && !input.body.name) input.body.name = input.body.displayName;
    if (input.body.avatarUrl && !input.body.avatar) input.body.avatar = input.body.avatarUrl;
    if (input.body.coverUrl && !input.body.coverImage) input.body.coverImage = input.body.coverUrl;

    // 2) Filtered out unwanted field names that are not allowed to be updated
    const allowedFields = [
        'name', 'email', 'username', 'bio', 'location',
        'coverImage', 'avatar', 'phone', 'emergencyPhone',
        'address', 'bioBlocks', 'ridingPace'
    ];
    const filteredBody = {};
    Object.keys(input.body).forEach(el => {
        if (allowedFields.includes(el)) filteredBody[el] = input.body[el];
    });

    if (filteredBody.username) {
        filteredBody.username = filteredBody.username.toLowerCase().trim();
        const usernameRegex = /^[a-z0-9_]{3,20}$/;
        if (!usernameRegex.test(filteredBody.username)) {
            return throwError(new AppError('Geçersiz kullanıcı adı formatı.', 400));
        }
        if (isReservedUsername(filteredBody.username) && (!input.user || !input.user.isAdmin)) {
            return throwError(new AppError('Bu kullanıcı adı alınamaz. Marka veya sistem politikası gereği rezerve edilmiştir.', 400));
        }
        const existingUser = await User.findOne({ username: filteredBody.username, _id: { $ne: input.user.id } });
        if (existingUser) {
            return throwError(new AppError('Bu kullanıcı adı maalesef başkası tarafından kullanılıyor.', 400));
        }
    }

    // Email Uniqueness & Validation Check
    if (filteredBody.email) {
        filteredBody.email = filteredBody.email.toLowerCase().trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(filteredBody.email)) {
            return throwError(new AppError('Geçersiz e-posta adresi formatı.', 400));
        }
        const existingEmail = await User.findOne({ email: filteredBody.email, _id: { $ne: input.user.id } });
        if (existingEmail) {
            return throwError(new AppError('Bu e-posta adresi zaten başka bir hesap tarafından kullanılıyor.', 409));
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
        return throwError(new AppError('Geçersiz profil fotoğrafı bağlantı formatı.', 400));
    }
    if (filteredBody.coverImage && !isSafeUrlScheme(filteredBody.coverImage)) {
        return throwError(new AppError('Geçersiz kapak fotoğrafı bağlantı formatı.', 400));
    }

    // 3) Update user document
    // For Mixed type arrays (bioBlocks), validate and sanitize strictly
    if (filteredBody.bioBlocks !== undefined) {
        const user = await User.findById(input.user.id);
        if (!user) {
            return raiseHttpError({ status: 'fail', message: 'Kullanıcı bulunamadı.' },404,{legacyExact:true});
        }

        // Studio route picker uses /routes/my (author), not only savedRoutes favorites
        const authoredRoutes = await Route.find({ author: user._id }).select('_id').lean();
        const authoredRouteIds = authoredRoutes.map((r) => r._id.toString());

        const validation = validateAndSanitizeBioBlocks(filteredBody.bioBlocks, user, {
            authoredRouteIds
        });
        if (validation.error) {
            return raiseHttpError({
                status: 'fail',
                message: validation.error,
                requiresPro: validation.requiresPro
            },validation.status || 400,{legacyExact:true});
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
        const savedUser = await User.findById(input.user.id).select('-password');

        return respond({
            status: 'success',
            data: { user: savedUser }
        },200);
    }

    // Standard update for non-Mixed fields
    const updatedUser = await User.findByIdAndUpdate(input.user.id, filteredBody, {
        new: true,
        runValidators: true
    }).select('-password');

    respond({
        status: 'success',
        data: {
            user: updatedUser
        }
    },200);

    return response;
};

export const updateSettings = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    // fields: privacy (obj), notifications (obj), password (handled via auth route usually, but here we might just do settings)
    // The prompt requested a specific PUT /api/users/update-settings
    // Password change usually requires a separate sensitive route, but we can check if it's here.
    // NOTE: For password change, we'll keep it simple or strictly separate.
    // Let's handle privacy and notifications here.

    const allowedFields = ['privacy', 'notifications'];
    const filteredBody = {};
    Object.keys(input.body).forEach(el => {
        if (allowedFields.includes(el)) filteredBody[el] = input.body[el];
    });

    const updatedUser = await User.findByIdAndUpdate(input.user.id, filteredBody, {
        new: true,
        runValidators: true
    }).select('-password -spotifyRefreshToken');

    respond({
        status: 'success',
        data: {
            user: updatedUser
        }
    },200);

    return response;
};

export const searchUsers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { q } = input.query;
    if (!q || typeof q !== 'string' || !q.trim()) {
        return throwError(new AppError('Arama terimi giriniz.', 400));
    }

    const page = parseInt(input.query.page) || 1;
    const limit = parseInt(input.query.limit) || 20;
    const skip = (page - 1) * limit;

    const escapedQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = {
        isDeleted: { $ne: true },
        $or: [
            { name: { $regex: escapedQuery, $options: 'i' } },
            { username: { $regex: escapedQuery, $options: 'i' } }
        ]
    };

    if (input.user?.id) {
        const myBlocked = input.user.blockedUsers || [];
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

    respond({
        status: 'success',
        results: users.length,
        hasMore,
        data: {
            users
        }
    },200);

    return response;
};

export const getAllUsers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const page = parseInt(input.query.page) || 1;
    const limit = Math.min(100, Math.max(1, parseInt(input.query.limit) || 20));
    const skip = (page - 1) * limit;

    // Strict allowlist query builder - NO raw req.query pass-through to prevent query injection
    const query = {};

    if (typeof input.query.search === 'string' && input.query.search.trim()) {
        const escaped = input.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
            { name: { $regex: escaped, $options: 'i' } },
            { username: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } }
        ];
    }

    if (typeof input.query.userType === 'string' && ['INDIVIDUAL', 'PROFESSIONAL'].includes(input.query.userType)) {
        query.userType = input.query.userType;
    }

    if (typeof input.query.isVerified === 'string') {
        query.isVerified = input.query.isVerified === 'true';
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

    respond({
        status: 'success',
        results: usersWithCounts.length,
        total: totalUsers,
        hasMore,
        data: usersWithCounts
    },200);

    return response;
};

export const requestVerification = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id);

    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.verificationStatus === 'approved') {
        return throwError(new AppError('Zaten onaylı bir hesapsınız.', 400));
    }

    if (user.verificationStatus === 'pending') {
        return throwError(new AppError('Onay başvurunuz zaten inceleniyor.', 400));
    }

    user.verificationStatus = 'pending';
    // isVerified remains false
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Doğrulama başvurunuz alındı.',
        data: {
            verificationStatus: user.verificationStatus
        }
    },200);

    return response;
};

export const updateVerificationStatus = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    // Only Admin
    if (!input.user.isAdmin) {
        return throwError(new AppError('Bu işlem için yetkiniz yok.', 403));
    }

    const { userId, status } = input.body; // status: 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return throwError(new AppError('Geçersiz durum.', 400));
    }

    const user = await User.findById(userId);
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    user.verificationStatus = status;
    user.isVerified = (status === 'approved');
    if (user.userType === 'PROFESSIONAL' && user.businessProfile) {
        user.businessProfile.verifiedBadge = status === 'approved';
        user.markModified('businessProfile');
    }

    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: `Kullanıcı durumu ${status} olarak güncellendi.`,
        data: {
            userId: user._id,
            verificationStatus: user.verificationStatus,
            isVerified: user.isVerified
        }
    },200);

    return response;
};

export const onboardUser = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { nickname, phone, bike } = input.body;

    if (!nickname) {
        return throwError(new AppError('Lütfen bir kullanıcı adı girin.', 400));
    }

    const user = await User.findById(input.user.id).select('+tokenVersion');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    // Check username uniqueness
    const existingUsername = await User.findOne({ username: nickname, _id: { $ne: user._id } });
    if (existingUsername) {
        return throwError(new AppError('Bu kullanıcı adı zaten alınmış.', 400));
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

    await takeResult(createSessionResult(user,200));

    return response;
};

export const toggleGhostMode = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id).select('isPro isGhostMode proExpiryDate isAdmin isPremium');

    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

    // PRO / APEX kontrolü (Admin, Premium veya aktif Pro)
    if (!hasActiveApexAccess(user)) {
        return throwError(new AppError('Ghost Mode yalnızca MotoVibe PRO üyelerine açıktır.', 403));
    }

    // Toggle
    const newState = input.body.isGhostMode !== undefined
        ? Boolean(input.body.isGhostMode)
        : !user.isGhostMode;

    user.isGhostMode = newState;
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        data: { isGhostMode: user.isGhostMode },
        message: user.isGhostMode ? '👻 Ghost Mode aktif — Radar sessizliği başladı.' : 'Ghost Mode kapatıldı.'
    },200);

    return response;
};

export const updateThemePreference = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { accentColor } = input.body;

    if (!accentColor) {
        return throwError(new AppError('Accent rengi belirtilmedi.', 400));
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(accentColor)) {
        return throwError(new AppError('Gecerli bir hex renk formati giriniz.', 400));
    }

    if (!ALLOWED_ACCENT_COLORS.includes(accentColor.toUpperCase())) {
        return throwError(new AppError('Bu renk Moto-Palette listesinde mevcut degil.', 400));
    }

    const user = await User.findById(input.user.id).select('isPro proExpiryDate preferences');
    if (!user) return throwError(new AppError('Kullanici bulunamadi.', 404));

    const freeColors = ['#E2FF3B', '#CC0000'];
    if (!freeColors.includes(accentColor.toUpperCase())) {
        const isPro = user.isPro && (!user.proExpiryDate || user.proExpiryDate > new Date());
        if (!isPro) {
            return raiseHttpError({
                status: 'fail',
                message: 'Kokpit Aydinlatmasi ozelligi sadece APEX Suruculeri icin gecerlidir.',
                requiresApex: true
            },403,{legacyExact:true});
        }
    }

    if (!user.preferences) user.preferences = {};
    user.preferences.accentColor = accentColor.toUpperCase();
    user.markModified('preferences');
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        data: { accentColor: user.preferences.accentColor },
        message: 'Kokpit aydinlatmasi guncellendi.'
    },200);

    return response;
};

export const saveTelemetry = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { distanceKm, topSpeed, maxLeanAngle, city, cityName } = input.body;

    const safeDistance = Number(distanceKm) || 0;
    const safeTopSpeed = Number(topSpeed) || 0;
    const safeMaxLean = Number(maxLeanAngle) || 0;

    if (safeDistance < 0 || safeTopSpeed < 0 || safeMaxLean < 0) {
        return throwError(new AppError('Telemetri degerleri negatif olamaz.', 400));
    }

    // Makul sürüş sınırları (Tek sürüş için maks 300 km, maks hız 299 km/s, maks yatış açısı 65 derece)
    if (safeDistance > 300 || safeTopSpeed > 299 || safeMaxLean > 65) {
        return throwError(new AppError('Telemetri değerleri makul sürüş sınırlarının dışında (Maks 300 km / 299 km/s / 65°).', 400));
    }

    const updateQuery = {
        $inc: { totalKm: Math.round(safeDistance * 10) / 10 }
    };

    const user = await User.findById(input.user.id).select('topSpeed totalKm achievementProgress');
    if (!user) return throwError(new AppError('Kullanici bulunamadi.', 404));

    if (safeTopSpeed > (user.topSpeed || 0)) {
        updateQuery.$set = { topSpeed: Math.round(safeTopSpeed) };
    }

    const updatedUser = await User.findByIdAndUpdate(input.user.id, updateQuery, { new: true })
        .select('totalKm topSpeed');

    if (safeMaxLean > 0) {
        await setMaxMetric(input.user.id, 'maxLeanAngle', safeMaxLean);
    }

    const targetCity = (city || cityName || '').toString().trim();
    if (targetCity) {
        await recordVisitedCity(input.user.id, targetCity);
    }

    evaluateAndUnlock(input.user.id).catch(err => console.error('[Telemetry] evaluateAndUnlock error:', err));

    respond({
        status: 'success',
        data: {
            totalKm: updatedUser.totalKm,
            topSpeed: updatedUser.topSpeed
        }
    },200);

    return response;
};

export const checkUsernameAvailability = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { username } = input.body;
    if (!username) return throwError(new AppError('Kullanıcı adı belirtilmedi.', 400));

    const cleanUsername = username.toLowerCase().trim();
    const usernameRegex = /^[a-z0-9_]{3,20}$/;

    if (!usernameRegex.test(cleanUsername)) {
        return respond({
            status: 'success',
            isAvailable: false,
            message: 'Kullanıcı adı sadece küçük harf, rakam ve alt çizgi (_) içerebilir (3-20 karakter).'
        },200);
    }

    if (isReservedUsername(cleanUsername) && (!input.user || !input.user.isAdmin)) {
        return respond({
            status: 'success',
            isAvailable: false,
            message: 'Bu kullanıcı adı marka/sistem politikası gereği rezerve edilmiştir.'
        },200);
    }

    const existingUser = await User.findOne({ username: cleanUsername });
    respond({
        status: 'success',
        isAvailable: !existingUser || (input.user && existingUser._id.toString() === input.user.id),
        username: cleanUsername
    },200);

    return response;
};
