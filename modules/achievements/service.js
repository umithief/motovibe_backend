import mongoose from 'mongoose';
import User from "../users/model.js";
import Achievement from "./model.js";
import Notification from "../notifications/model.js";
import { defaultAchievements } from "../../data/achievements.js";
import { createNotification } from "../notifications/service.js";

/**
 * Calculates rank and level deterministically from APEX points.
 * Single source of truth across BE & FE.
 */
export const calculateRankAndLevel = (points = 0) => {
    const safePoints = Math.max(0, Number(points) || 0);
    const level = Math.floor(safePoints / 100) + 1;

    let rank = 'Çaylak Sürücü';
    if (safePoints >= 35000) {
        rank = 'Efsane Sürücü';
    } else if (safePoints >= 20000) {
        rank = 'Elit Sürücü';
    } else if (safePoints >= 12000) {
        rank = 'Kademe Ustası';
    } else if (safePoints >= 5000) {
        rank = 'Rota Komutanı';
    } else if (safePoints >= 2000) {
        rank = 'Asfalt Kâşifi';
    } else if (safePoints >= 500) {
        rank = 'Sokak Pilotu';
    }

    return { rank, level, points: safePoints };
};

/**
 * Ensures default achievements are seeded idempotently and updated.
 */
export const ensureDefaultAchievements = async () => {
    try {
        for (const ach of defaultAchievements) {
            await Achievement.findOneAndUpdate(
                { slug: ach.slug },
                { $set: ach },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }
        console.log(`✅ [Achievement Engine] Successfully synchronized ${defaultAchievements.length} achievements.`);
    } catch (err) {
        console.error('❌ [Achievement Engine] Failed to ensure default achievements:', err.message);
    }
};

/**
 * Increments a specific progress metric for a user and triggers evaluation.
 */
export const incrementMetric = async (userId, metric, delta = 1) => {
    try {
        if (!userId || !metric) return;
        const user = await User.findById(userId);
        if (!user) return;

        if (!user.achievementProgress) {
            user.achievementProgress = new Map();
        }

        const deltaVal = Number(delta || 1);
        if (typeof user.achievementProgress.get === 'function') {
            const current = user.achievementProgress.get(metric) || 0;
            user.achievementProgress.set(metric, Math.max(0, current + deltaVal));
        } else {
            const current = user.achievementProgress[metric] || 0;
            user.achievementProgress[metric] = Math.max(0, current + deltaVal);
        }

        user.markModified('achievementProgress');
        await user.save({ validateBeforeSave: false });

        await evaluateAndUnlock(userId);
    } catch (err) {
        console.error(`[Achievement Engine] Error incrementing metric ${metric}:`, err.message);
    }
};

/**
 * Sets a metric to a new max value if higher than current record.
 */
export const setMaxMetric = async (userId, metric, value) => {
    try {
        if (!userId || !metric) return;
        const safeValue = Number(value) || 0;
        const user = await User.findById(userId);
        if (!user) return;

        if (!user.achievementProgress) {
            user.achievementProgress = new Map();
        }

        if (typeof user.achievementProgress.get === 'function') {
            const current = user.achievementProgress.get(metric) || 0;
            if (safeValue > current) {
                user.achievementProgress.set(metric, safeValue);
                user.markModified('achievementProgress');
                await user.save({ validateBeforeSave: false });
                await evaluateAndUnlock(userId);
            }
        } else {
            const current = user.achievementProgress[metric] || 0;
            if (safeValue > current) {
                user.achievementProgress[metric] = safeValue;
                user.markModified('achievementProgress');
                await user.save({ validateBeforeSave: false });
                await evaluateAndUnlock(userId);
            }
        }
    } catch (err) {
        console.error(`[Achievement Engine] Error setting max metric ${metric}:`, err.message);
    }
};

/**
 * Records a unique city visit and increments uniqueCities if new.
 */
export const recordVisitedCity = async (userId, cityName) => {
    try {
        if (!userId || !cityName || typeof cityName !== 'string') return;
        const cleanCity = cityName.trim().toLowerCase();
        if (!cleanCity) return;

        const user = await User.findById(userId);
        if (!user) return;

        if (!user.achievementProgress) {
            user.achievementProgress = new Map();
        }

        const currentCities = user.visitedCities || [];
        if (!currentCities.some(c => c.toLowerCase() === cleanCity)) {
            currentCities.push(cityName.trim());
            user.visitedCities = currentCities;
            user.markModified('visitedCities');

            if (typeof user.achievementProgress.set === 'function') {
                user.achievementProgress.set('uniqueCities', currentCities.length);
            } else {
                user.achievementProgress['uniqueCities'] = currentCities.length;
            }
            user.markModified('achievementProgress');
            await user.save({ validateBeforeSave: false });
            await evaluateAndUnlock(userId);
        }
    } catch (err) {
        console.error('[Achievement Engine] Error recording visited city:', err.message);
    }
};

/**
 * Evaluates all achievements for a given user, updates rank, awards APEX points, and unlocks qualifying achievements.
 */
export const evaluateAndUnlock = async (userId) => {
    try {
        if (!userId) return null;
        const user = await User.findById(userId);
        if (!user) return null;

        let achievements = await Achievement.find().lean();
        if (achievements.length === 0) {
            await ensureDefaultAchievements();
            achievements = await Achievement.find().lean();
        }

        let needsSave = false;
        const unlockedSet = new Set((user.unlockedAchievements || []).map(id => id.toString()));

        const getProgress = (key) => {
            if (!user.achievementProgress) return 0;
            if (typeof user.achievementProgress.get === 'function') {
                return user.achievementProgress.get(key) || 0;
            }
            return user.achievementProgress[key] || 0;
        };

        // Calculate network / follow graph dynamically
        const followersCount = Array.isArray(user.followers) ? user.followers.length : (Number(user.followers) || 0);
        const followingCount = Array.isArray(user.following) ? user.following.length : (Number(user.following) || 0);
        const dynamicFollowGraph = followersCount + followingCount;

        let newlyUnlocked = [];
        let totalBonusPoints = 0;

        for (const ach of achievements) {
            if (unlockedSet.has(ach._id.toString())) continue; // Already unlocked

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

            if (ach.requiredValue > 0 && currentValue >= ach.requiredValue) {
                // Unlock!
                unlockedSet.add(ach._id.toString());
                needsSave = true;
                const bonus = ach.pointsReward || (ach.badgeType === 'Gold' ? 250 : ach.badgeType === 'Neon' ? 100 : 50);
                totalBonusPoints += bonus;
                newlyUnlocked.push({ ...ach, pointsAwarded: bonus });

                // Create in-app Notification via centralized helper (respects user.notifications.achievements)
                try {
                    await createNotification({
                        recipient: user._id,
                        sender: user._id,
                        type: 'ACHIEVEMENT_UNLOCKED',
                        text: `"${ach.title}" başarımının kilidini açtın! (+${bonus} APEX)`,
                        relatedId: ach._id.toString()
                    });
                } catch (notifErr) {
                    console.error('[Achievement Notification] Error:', notifErr.message);
                }
            }
        }

        if (totalBonusPoints > 0) {
            user.points = (user.points || 0) + totalBonusPoints;
            needsSave = true;
        }

        // Update rank based on current points
        const { rank: computedRank } = calculateRankAndLevel(user.points || 0);
        if (user.rank !== computedRank) {
            user.rank = computedRank;
            needsSave = true;
        }

        if (needsSave) {
            user.unlockedAchievements = Array.from(unlockedSet);
            await user.save({ validateBeforeSave: false });
        }

        return {
            newlyUnlocked,
            totalBonusPoints,
            unlockedCount: unlockedSet.size
        };
    } catch (error) {
        console.error('Achievement Engine Error:', error);
        return null;
    }
};
