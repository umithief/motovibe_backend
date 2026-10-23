import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import User from "./model.js";
import Achievement from "../achievements/model.js";

import AppError from "../../utils/appError.js";
import { evaluateAndUnlock, ensureDefaultAchievements, calculateRankAndLevel, incrementMetric, setMaxMetric, recordVisitedCity } from "../achievements/service.js";

export const seedAchievements = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    // Sadece admin yetkisi ile çalıştırılabilir
    await ensureDefaultAchievements();

    respond({
        status: 'success',
        message: 'Achievements seeded successfully'
    },200);

    return response;
};

export const getAllAchievements = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    // Normal kullanıcılar kendi başarımlarını veya profilini inceledikleri diğer sürücülerin başarımlarını görüntüleyebilir
    const targetUserId = input.query.userId || input.user?.id;
    if (!targetUserId) return throwError(new AppError('Kullanıcı kimliği belirtilmedi.', 400));

    // Eğer kendi başarımlarını görüntülüyorsa anlık değerlendir ve yeni kilit açılışlarını yakala
    if (input.user?.id && targetUserId.toString() === input.user.id.toString()) {
        await evaluateAndUnlock(targetUserId);
    }

    const user = await User.findById(targetUserId).select('points totalKm topSpeed maxLeanAngle achievementProgress unlockedAchievements rank followers following visitedCities name username');
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

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

    respond({
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
    },200);

    return response;
};
