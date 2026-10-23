import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { raiseHttpError } from '../../utils/httpError.js';
import { rideOwnerFilter } from "./service.js";

import mongoose from 'mongoose';
import Ride from "./model.js";
import User from "../users/model.js";
import { evaluateAndUnlock } from "../achievements/service.js";
import Pack from "../packs/model.js";
import {
    addWeeklyDistance,
    addWeeklyPackDistance,
    recordMaxLeanAngle
} from "../leaderboards/service.js";

// Haversine Formula for Distance (in km)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

export const resolveOwnedBikeId = async (bikeId, ownerId) => mongoose.Types.ObjectId.isValid(bikeId) &&
    await User.exists({ _id: ownerId, 'garage._id': bikeId }) ? bikeId : undefined;

export const createRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const {
            title,
            coordinates,
            telemetry,
            bikeId,
            description,
            isPublic,
            distance: manualDistance,
            duration: manualDuration,
            avgSpeed: manualAvgSpeed,
            maxSpeed: manualMaxSpeed
        } = input.body;
        const userId = input.user._id; // From auth middleware

        if (!coordinates || coordinates.length < 2) {
            return raiseHttpError({ success: false, message: 'Geçersiz koordinat verisi. En az 2 nokta gerekli.' },400);
        }

        // --- ANALYSIS LOGIC ---
        let maxSpeed = 0;
        let totalSpeed = 0;
        let maxLeanAngle = 0;
        let maxGForce = 0;

        // Analyze Telemetry
        if (telemetry && telemetry.length > 0) {
            telemetry.forEach(point => {
                if (point.speed > maxSpeed) maxSpeed = point.speed;
                if (point.leanAngle > maxLeanAngle) maxLeanAngle = point.leanAngle;
                if (point.gForce > maxGForce) maxGForce = point.gForce;
                totalSpeed += point.speed;
            });
        }

        // Analyze Route (Distance)
        let totalDistance = 0;
        for (let i = 0; i < coordinates.length - 1; i++) {
            const [lon1, lat1] = coordinates[i];
            const [lon2, lat2] = coordinates[i + 1];
            totalDistance += calculateDistance(lat1, lon1, lat2, lon2);
        }

        // Duration (from telemetry timestamps or simple mock if relying on interval)
        // Assuming telemetry is ordered by time
        let duration = 0;
        if (telemetry && telemetry.length > 1) {
            const start = new Date(telemetry[0].timestamp).getTime();
            const end = new Date(telemetry[telemetry.length - 1].timestamp).getTime();
            duration = (end - start) / 1000; // seconds
        }

        let avgSpeed = telemetry && telemetry.length > 0 ? (totalSpeed / telemetry.length) : 0;

        const safeManualDistance = Number(manualDistance);
        if (Number.isFinite(safeManualDistance) && safeManualDistance > 0) {
            totalDistance = safeManualDistance;
        }

        const safeManualDuration = Number(manualDuration);
        if (Number.isFinite(safeManualDuration) && safeManualDuration > 0) {
            duration = safeManualDuration;
        }

        const safeManualAvgSpeed = Number(manualAvgSpeed);
        if (Number.isFinite(safeManualAvgSpeed) && safeManualAvgSpeed >= 0) {
            avgSpeed = safeManualAvgSpeed;
        }

        const safeManualMaxSpeed = Number(manualMaxSpeed);
        if (Number.isFinite(safeManualMaxSpeed) && safeManualMaxSpeed >= 0) {
            maxSpeed = Math.max(maxSpeed, safeManualMaxSpeed);
        }

        // Create Ride
        const cleanBikeId = await resolveOwnedBikeId(bikeId, userId);

        const newRide = await Ride.create({
            user:userId,
            userId,
            bikeId: cleanBikeId,
            title: title || `Sürüş - ${new Date().toLocaleDateString('tr-TR')}`,
            description,
            isPublic: isPublic !== undefined ? isPublic : true,
            route: {
                type: 'LineString',
                coordinates: coordinates
            },
            telemetry: telemetry || [],
            stats: {
                maxSpeed,
                avgSpeed,
                maxLeanAngle,
                maxGForce,
                totalDistance: parseFloat(totalDistance.toFixed(2)),
                duration: Math.round(duration)
            }
        });

        // Optional: Update User Stats (Total KM)
        // Evaluate Telemetry & Achievements
        const userForTelemetry = await User.findById(userId);
        if (userForTelemetry) {
            let maxSpeedFromRide = Number(maxSpeed) || 0;
            const rideTopSpeed = Math.max(safeManualMaxSpeed || 0, maxSpeedFromRide);

            const newTotalKm = (userForTelemetry.totalKm || 0) + parseFloat(totalDistance.toFixed(1));
            const newTopSpeed = Math.max(userForTelemetry.topSpeed || 0, rideTopSpeed);
            const gainedPoints = parseFloat((totalDistance * 10).toFixed(0));

            userForTelemetry.points = (userForTelemetry.points || 0) + gainedPoints;
            userForTelemetry.totalKm = newTotalKm;
            userForTelemetry.topSpeed = newTopSpeed;

            // Track maxLeanAngle if provided in telemetry
            if (maxLeanAngle > 0) {
                const currentMaxLean = (userForTelemetry.achievementProgress && userForTelemetry.achievementProgress.get('maxLeanAngle')) || 0;
                if (maxLeanAngle > currentMaxLean) {
                    if (!userForTelemetry.achievementProgress) userForTelemetry.achievementProgress = new Map();
                    userForTelemetry.achievementProgress.set('maxLeanAngle', maxLeanAngle);
                }
            }

            // Track Night Rides (00:00 - 04:00)
            const currentHour = new Date().getHours();
            if (currentHour >= 0 && currentHour < 4) {
                const nightRides = (userForTelemetry.achievementProgress && userForTelemetry.achievementProgress.get('nightRides')) || 0;
                if (!userForTelemetry.achievementProgress) userForTelemetry.achievementProgress = new Map();
                userForTelemetry.achievementProgress.set('nightRides', nightRides + 1);
            }

            // Track unique cities if location logic existed here - omitting for now unless easily deduced from coordinates

            await userForTelemetry.save({ validateBeforeSave: false });

            // Trigger Achievement Engine
            evaluateAndUnlock(userId).catch(err => console.error("Achievement Engine async error:", err));
        }

        // Leaderboard updates (non-blocking for ride save)
        try {
            const distanceScore = parseFloat(totalDistance.toFixed(2));
            const leanScore = parseFloat(maxLeanAngle.toFixed(2));
            await addWeeklyDistance(userId, distanceScore);
            await recordMaxLeanAngle(userId, leanScore);

            const pack = await Pack.findOne({ members: userId })
                .select('_id')
                .lean();
            if (pack?._id) {
                await addWeeklyPackDistance(pack._id.toString(), distanceScore);
            }
        } catch (leaderboardErr) {
            console.warn('[Ride] Leaderboard update skipped:', leaderboardErr.message);
        }

        respond({
            success: true,
            status: 'success',
            message: 'Sürüş başarıyla kaydedildi ve analiz edildi.',
            data: newRide
        },201);

    } catch (error) { throw error; }

    return response;
};

export const getRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const ride = await Ride.findById(input.params.id)
            .populate('userId', 'name avatar rank');

        if (!ride) {
            return raiseHttpError({ success: false, message: 'Sürüş verisi bulunamadı.' },404);
        }

        const requesterId = input.user?._id?.toString() || input.user?.id?.toString();
        const ownerId = (ride.user?._id || ride.user || ride.userId?._id || ride.userId)?.toString();
        const isAdmin = input.user?.isAdmin === true;

        if (!ride.isPublic && requesterId !== ownerId && !isAdmin) {
            return raiseHttpError({ success: false, message: 'Bu sürüş gizlidir.' },403);
        }

        // Preserve the populated bikeId shape without a nonexistent UserBike model.
        // Expose only public bike fields; verification and maintenance stay private.
        let data = ride;
        if (ride.bikeId) {
            const owner = await User.findOne({ _id: ownerId, 'garage._id': ride.bikeId })
                .select('garage._id garage.brand garage.model garage.year garage.image garage.color garage.cc garage.hp garage.style garage.isPrimary garage.isVerified')
                .lean();
            const bike = owner?.garage?.find(item => String(item._id) === String(ride.bikeId));
            const publicFields = ['_id','brand','model','year','image','color','cc','hp','style','isPrimary','isVerified'];
            const publicBike = bike ? Object.fromEntries(publicFields.filter(key => bike[key] !== undefined).map(key => [key,bike[key]])) : null;
            data = { ...(ride.toObject ? ride.toObject({virtuals:true}) : ride), bikeId: publicBike };
        }
        respond({ success: true, status: 'success', data },200);
    } catch (error) { throw error; }

    return response;
};

export const getUserRides = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { userId } = input.params;
        const page = parseInt(input.query.page) || 1;
        const limit = parseInt(input.query.limit) || 10;
        const skip = (page - 1) * limit;

        const requesterId = input.user?._id?.toString() || input.user?.id?.toString();
        const isOwnerOrAdmin = requesterId === userId.toString() || input.user?.isAdmin === true;

        const query = rideOwnerFilter(userId);
        if (!isOwnerOrAdmin) {
            query.isPublic = true;
        }

        const rides = await Ride.find(query)
            .sort({ date: -1 }) // Newest first
            .skip(skip)
            .limit(limit);

        const total = await Ride.countDocuments(query);

        respond({
            success: true,
            status: 'success',
            count: rides.length,
            pagination: { total, page, pages: Math.ceil(total / limit) },
            data: rides
        },200);
    } catch (error) { throw error; }

    return response;
};

// Legacy compatibility endpoint for older frontend payloads.
// @route   POST /api/users/rides
// @access  Private
export const createLegacyRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const userId = input.user?._id;
        if (!userId) {
            return raiseHttpError({
                success: false,
                message: 'Kimlik doğrulaması gerekli.',
            },401);
        }

        const safeDistance = Number(input.body?.distance) || 0;
        const safeDuration = Number(input.body?.duration) || 0;
        const safeAvgSpeed = Number(input.body?.avgSpeed) || 0;
        const safeMaxSpeed = Number(input.body?.maxSpeed) || 0;
        const safeDate = new Date(input.body?.date || Date.now());

        const coordinates = Array.isArray(input.body?.coordinates) && input.body.coordinates.length >= 2
            ? input.body.coordinates
            : null;

        if (!coordinates) {
            return raiseHttpError({
                success: false,
                message: 'Geçersiz koordinat verisi. Gerçek sürüş koordinatları gereklidir (sahte koordinat kabul edilmez).',
            },400);
        }

        const ride = await Ride.create({
            user:userId,
            userId,
            title: input.body?.title || 'Sürüş Modu Kaydı',
            date: Number.isNaN(safeDate.getTime()) ? new Date() : safeDate,
            description: input.body?.description || 'Sürüş kaydı',
            isPublic: input.body?.isPublic !== undefined ? input.body.isPublic : true,
            route: {
                type: 'LineString',
                coordinates: coordinates,
            },
            telemetry: input.body?.telemetry || [],
            stats: {
                totalDistance: Math.max(0, safeDistance),
                duration: Math.max(0, safeDuration),
                avgSpeed: Math.max(0, safeAvgSpeed),
                maxSpeed: Math.max(0, safeMaxSpeed),
                maxLeanAngle: 0,
                maxGForce: 0,
                elevationGain: 0,
            },
        });

        await User.findByIdAndUpdate(userId, {
            $inc: { points: Math.max(0, Math.round(safeDistance * 10)) },
        });

        return respond({
            success: true,
            status: 'success',
            message: 'Sürüş özeti kaydedildi.',
            data: ride,
        },201);
    } catch (error) { throw error; }

    return response;
};

export const deleteRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const ride = await Ride.findOneAndDelete({ _id: input.params.id, ...rideOwnerFilter(input.user._id) });

        if (!ride) {
            return raiseHttpError({ success: false, message: 'Sürüş bulunamadı veya yetkiniz yok.' },404);
        }

        respond({ success: true, status: 'success', message: 'Sürüş silindi.' },200);
    } catch (error) { throw error; }

    return response;
};
