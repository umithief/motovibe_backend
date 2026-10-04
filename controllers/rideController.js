import mongoose from 'mongoose';
import Ride from '../models/Ride.js';
import User from '../models/User.js';
import { evaluateAndUnlock } from '../services/achievementEngine.js';
import Pack from '../models/Pack.js';
import {
    addWeeklyDistance,
    addWeeklyPackDistance,
    recordMaxLeanAngle
} from '../services/leaderboardService.js';

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

export const createRide = async (req, res) => {
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
        } = req.body;
        const userId = req.user._id; // From auth middleware

        if (!coordinates || coordinates.length < 2) {
            return res.status(400).json({ success: false, message: 'Geçersiz koordinat verisi. En az 2 nokta gerekli.' });
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
        const cleanBikeId = mongoose.Types.ObjectId.isValid(bikeId) ? bikeId : undefined;

        const newRide = await Ride.create({
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

        res.status(201).json({
            success: true,
            status: 'success',
            message: 'Sürüş başarıyla kaydedildi ve analiz edildi.',
            data: newRide
        });

    } catch (error) {
        console.error('Ride Create Error:', error);
        res.status(500).json({ success: false, message: 'Sürüş kaydedilemedi.', error: error.message });
    }
};

export const getRide = async (req, res) => {
    try {
        const ride = await Ride.findById(req.params.id)
            .populate('userId', 'name avatar rank')
            .populate('bikeId'); // Assuming bike model/brand is needed

        if (!ride) {
            return res.status(404).json({ success: false, message: 'Sürüş verisi bulunamadı.' });
        }

        const requesterId = req.user?._id?.toString() || req.user?.id?.toString();
        const ownerId = (ride.userId?._id || ride.userId)?.toString();
        const isAdmin = req.user?.isAdmin === true;

        if (!ride.isPublic && requesterId !== ownerId && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Bu sürüş gizlidir.' });
        }

        res.status(200).json({ success: true, status: 'success', data: ride });
    } catch (error) {
        console.error('Get Ride Error:', error);
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
};

export const getUserRides = async (req, res) => {
    try {
        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const requesterId = req.user?._id?.toString() || req.user?.id?.toString();
        const isOwnerOrAdmin = requesterId === userId.toString() || req.user?.isAdmin === true;

        const query = { userId };
        if (!isOwnerOrAdmin) {
            query.isPublic = true;
        }

        const rides = await Ride.find(query)
            .sort({ date: -1 }) // Newest first
            .skip(skip)
            .limit(limit);

        const total = await Ride.countDocuments(query);

        res.status(200).json({
            success: true,
            status: 'success',
            count: rides.length,
            pagination: { total, page, pages: Math.ceil(total / limit) },
            data: rides
        });
    } catch (error) {
        console.error('Get User Rides Error:', error);
        res.status(500).json({ success: false, message: 'Kullanıcı sürüşleri getirilemedi.' });
    }
};

// Legacy compatibility endpoint for older frontend payloads.
// @route   POST /api/users/rides
// @access  Private
export const createLegacyRide = async (req, res) => {
    try {
        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Kimlik doğrulaması gerekli.',
            });
        }

        const safeDistance = Number(req.body?.distance) || 0;
        const safeDuration = Number(req.body?.duration) || 0;
        const safeAvgSpeed = Number(req.body?.avgSpeed) || 0;
        const safeMaxSpeed = Number(req.body?.maxSpeed) || 0;
        const safeDate = new Date(req.body?.date || Date.now());

        const coordinates = Array.isArray(req.body?.coordinates) && req.body.coordinates.length >= 2
            ? req.body.coordinates
            : null;

        if (!coordinates) {
            return res.status(400).json({
                success: false,
                message: 'Geçersiz koordinat verisi. Gerçek sürüş koordinatları gereklidir (sahte koordinat kabul edilmez).',
            });
        }

        const ride = await Ride.create({
            userId,
            title: req.body?.title || 'Sürüş Modu Kaydı',
            date: Number.isNaN(safeDate.getTime()) ? new Date() : safeDate,
            description: req.body?.description || 'Sürüş kaydı',
            isPublic: req.body?.isPublic !== undefined ? req.body.isPublic : true,
            route: {
                type: 'LineString',
                coordinates: coordinates,
            },
            telemetry: req.body?.telemetry || [],
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

        return res.status(201).json({
            success: true,
            status: 'success',
            message: 'Sürüş özeti kaydedildi.',
            data: ride,
        });
    } catch (error) {
        console.error('Legacy Ride Create Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Legacy sürüş özeti kaydedilemedi.',
            error: error.message,
        });
    }
};

export const deleteRide = async (req, res) => {
    try {
        const ride = await Ride.findOneAndDelete({ _id: req.params.id, userId: req.user._id });

        if (!ride) {
            return res.status(404).json({ success: false, message: 'Sürüş bulunamadı veya yetkiniz yok.' });
        }

        res.status(200).json({ success: true, status: 'success', message: 'Sürüş silindi.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Silme işlemi başarısız.' });
    }
};
