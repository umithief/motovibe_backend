import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import mongoose from 'mongoose';
import User from "./model.js";

import AppError from "../../utils/appError.js";
import { createNotification } from "../notifications/service.js";
import { evaluateAndUnlock, ensureDefaultAchievements, calculateRankAndLevel, incrementMetric, setMaxMetric, recordVisitedCity } from "../achievements/service.js";
import redis from "../../config/redis.js";
import { parseFollowListPaging } from './service.js';
import { userLookupQuery, resolveViewerAccess } from './privacy.service.js';

export const toggleFollow = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    if (!mongoose.isValidObjectId(input.params.id)) {
        return throwError(new AppError('Geçersiz Kullanıcı ID.', 400));
    }

    if (input.user.id === input.params.id) {
        return throwError(new AppError('Kendinizi takip edemezsiniz.', 400));
    }

    const { id: targetUserId } = input.params;
    const currentUserId = input.user.id;

    const [currentUser, targetUser] = await Promise.all([
        User.findById(currentUserId),
        User.findById(targetUserId)
    ]);

    if (!targetUser || !currentUser) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    // Engel kontrolü
    const isTargetBlockedByMe = (currentUser.blockedUsers || []).some(b => b.toString() === targetUserId.toString());
    const amIBlockedByTarget = (targetUser.blockedUsers || []).some(b => b.toString() === currentUserId.toString());
    if (isTargetBlockedByMe || amIBlockedByTarget) {
        return throwError(new AppError('Bu kullanıcıyla takipleşemezsiniz.', 403));
    }

    const isCurrentlyFollowing = (currentUser.following || []).some(id => id.toString() === targetUserId.toString());

    let requestedAction = typeof input.body?.action === 'string'
        ? input.body.action.trim().toLowerCase()
        : null;
    if (!requestedAction && input.method === 'DELETE') {
        requestedAction = 'unfollow';
    }
    if (requestedAction !== 'follow' && requestedAction !== 'unfollow') {
        return throwError(new AppError('Takip işlemi için action follow veya unfollow olmalıdır.', 400));
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

        return respond({
            status: 'success',
            message: 'Takipten çıkıldı.',
            data: {
                isFollowing: false,
                followersCount: currentTargetFollowers,
                followingCount: currentUserFollowing
            }
        },200);
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

        return respond({
            status: 'success',
            message: 'Takip edildi.',
            data: {
                isFollowing: true,
                followersCount: currentTargetFollowers,
                followingCount: currentUserFollowing
            }
        },200);
    }

    return response;
};

export const getFollowersList = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { page, limit, skip } = parseFollowListPaging(input.query);

    const user = await User.findOne(userLookupQuery(input.params.id))
        .select('followers following privacy blockedUsers')
        .lean();

    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, input);
    if (access.blocked) {
        return throwError(new AppError('Bu kullanıcıya erişilemiyor.', 403));
    }
    if (access.isLocked) {
        return throwError(new AppError('Bu hesap kilitli.', 403));
    }

    const totalFollowers = user.followers ? user.followers.length : 0;
    const paginatedIds = user.followers ? user.followers.slice(skip, skip + limit) : [];

    const followers = await User.find({ _id: { $in: paginatedIds } })
        .select('_id name username avatar isVerified rank')
        .lean();

    const hasMore = skip + paginatedIds.length < totalFollowers;

    respond({
        status: 'success',
        hasMore,
        data: { users: followers }
    },200);

    return response;
};

export const getFollowingList = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { page, limit, skip } = parseFollowListPaging(input.query);

    const user = await User.findOne(userLookupQuery(input.params.id))
        .select('following followers privacy blockedUsers')
        .lean();

    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı', 404));
    }

    const access = resolveViewerAccess(user, input);
    if (access.blocked) {
        return throwError(new AppError('Bu kullanıcıya erişilemiyor.', 403));
    }
    if (access.isLocked) {
        return throwError(new AppError('Bu hesap kilitli.', 403));
    }

    const totalFollowing = user.following ? user.following.length : 0;
    const paginatedIds = user.following ? user.following.slice(skip, skip + limit) : [];

    const following = await User.find({ _id: { $in: paginatedIds } })
        .select('_id name username avatar isVerified rank')
        .lean();

    const hasMore = skip + paginatedIds.length < totalFollowing;

    respond({
        status: 'success',
        hasMore,
        data: { users: following }
    },200);

    return response;
};

export const blockUser = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { id } = input.params;
    const currentUserId = input.user.id;

    if (id === currentUserId) {
        return throwError(new AppError('Kendinizi engelleyemezsiniz.', 400));
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

    respond({
        status: 'success',
        message: 'Kullanıcı engellendi.'
    },200);

    return response;
};

export const unblockUser = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { id } = input.params;

    await User.findByIdAndUpdate(input.user.id, { $pull: { blockedUsers: id } });
    try {
        await redis.del(`feed:discover:${input.user.id}`);
    } catch (_) { }

    respond({
        status: 'success',
        message: 'Engel kaldırıldı.'
    },200);

    return response;
};

export const getBlockedUsers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id)
        .select('blockedUsers')
        .populate({
            path: 'blockedUsers',
            select: '_id name username avatar isVerified rank bio coverImage'
        })
        .lean();

    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const blockedList = (user.blockedUsers || []).filter(u => u != null);

    respond({
        status: 'success',
        results: blockedList.length,
        data: {
            users: blockedList
        }
    },200);

    return response;
};
