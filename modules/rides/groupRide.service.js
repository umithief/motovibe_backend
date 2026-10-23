import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { raiseHttpError } from '../../utils/httpError.js';

import GroupRide from "./GroupRide.model.js";
import Route from "../routes/model.js";
import User from "../users/model.js";
import { createNotification } from "../notifications/service.js";

export const getGroupRides = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { filter = 'all', pace, difficulty, search } = input.query;
        const currentUserId = input.user?._id?.toString() || input.query.userId || '';

        const query = {};

        // Filtre: upcoming vs completed
        const todayStr = new Date().toISOString().split('T')[0];
        if (filter === 'upcoming') {
            query.status = { $in: ['scheduled', 'active'] };
            query.date = { $gte: todayStr };
        } else if (filter === 'completed') {
            query.$and = [
                {
                    $or: [
                        { status: 'completed' },
                        { date: { $lt: todayStr } }
                    ]
                },
                { status: { $nin: ['cancelled', 'deleted'] } }
            ];
        } else {
            query.status = { $nin: ['cancelled', 'deleted'] };
        }

        if (pace && pace !== 'all') {
            query.pace = pace;
        }

        if (difficulty && difficulty !== 'all') {
            query.difficulty = difficulty;
        }

        if (search && search.trim().length > 0) {
            const regex = new RegExp(search.trim(), 'i');
            query.$or = [
                { title: regex },
                { meetingPoint: regex },
                { description: regex },
                { 'organizer.name': regex }
            ];
        }

        const rides = await GroupRide.find(query)
            .sort({ date: 1, time: 1 })
            .populate('routeId');

        const formattedRides = rides.map(ride => {
            const obj = ride.toObject();
            const isJoined = currentUserId
                ? (obj.organizer?.userId?.toString() === currentUserId ||
                   obj.participants?.some(p => p.userId?.toString() === currentUserId))
                : false;

            return {
                ...obj,
                isJoined,
                participantsCount: (obj.participants?.length || 0) + 1
            };
        });

        return respond({
            success: true,
            count: formattedRides.length,
            rides: formattedRides
        },200);
    } catch (error) { throw error; }

    return response;
};

export const getGroupRideById = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { id } = input.params;
        const currentUserId = input.user?._id?.toString() || '';

        const ride = await GroupRide.findById(id).populate('routeId');
        if (!ride) {
            return raiseHttpError({ success: false, error: 'Sürüş etkinliği bulunamadı.' },404);
        }

        const obj = ride.toObject();
        const isJoined = currentUserId
            ? (obj.organizer?.userId?.toString() === currentUserId ||
               obj.participants?.some(p => p.userId?.toString() === currentUserId))
            : false;

        return respond({
            success: true,
            ride: {
                ...obj,
                isJoined,
                participantsCount: (obj.participants?.length || 0) + 1
            }
        },200);
    } catch (error) { throw error; }

    return response;
};

export const createGroupRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const {
            title,
            description,
            coverImage,
            routeId,
            routeCoordinates,
            waypoints,
            date,
            time,
            meetingPoint,
            coordinates,
            pace,
            difficulty,
            minCcRequirement,
            distance,
            estimatedDuration,
            maxParticipants
        } = input.body;

        if (!title || !date || !time || !meetingPoint) {
            return raiseHttpError({
                success: false,
                error: 'Başlık, tarih, saat ve buluşma noktası alanları zorunludur.'
            },400);
        }

        const user = input.user;
        const organizer = {
            userId: user._id,
            name: user.name || user.username || 'Motonom Pilotu',
            avatar: user.avatar || '',
            bike: input.body.bike || ''
        };

        const newRide = new GroupRide({
            title,
            description: description || '',
            coverImage: coverImage || '',
            routeId: routeId || null,
            routeCoordinates: routeCoordinates || [],
            waypoints: waypoints || [],
            date,
            time,
            meetingPoint,
            coordinates: coordinates || { lat: 41.0082, lng: 28.9784 },
            organizer,
            pace: pace || 'moderate',
            difficulty: difficulty || 'medium',
            minCcRequirement: minCcRequirement || 0,
            distance: distance || '50 km',
            estimatedDuration: estimatedDuration || '1 saat 30 dk',
            maxParticipants: maxParticipants || 0,
            status: 'scheduled',
            participants: []
        });

        await newRide.save();
        return respond({ success: true, ride: newRide },201);
    } catch (error) { throw error; }

    return response;
};

export const joinGroupRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { id } = input.params;
        const user = input.user;

        const ride = await GroupRide.findById(id);
        if (!ride) {
            return raiseHttpError({ success: false, error: 'Sürüş bulunamadı.' },404);
        }

        // Kapasite kontrolü
        if (ride.maxParticipants > 0 && ride.participants.length >= ride.maxParticipants) {
            return raiseHttpError({ success: false, error: 'Bu sürüşün kontenjanı dolmuştur.' },400);
        }

        // Zaten katılmış mı kontrolü
        const isAlreadyJoined = ride.participants.some(p => p.userId.toString() === user._id.toString()) ||
                               ride.organizer.userId.toString() === user._id.toString();

        if (isAlreadyJoined) {
            return respond({ success: true, message: 'Zaten bu sürüşe kayıtlısınız.', ride },200);
        }

        ride.participants.push({
            userId: user._id,
            name: user.name || user.username || 'Motonom Pilotu',
            avatar: user.avatar || '',
            bike: input.body.bike || '',
            role: 'rider',
            joinedAt: new Date()
        });

        await ride.save();

        if (ride.organizer?.userId && ride.organizer.userId.toString() !== user._id.toString()) {
            createNotification({
                recipient: ride.organizer.userId,
                sender: user._id,
                type: 'RIDE_JOIN',
                ride: ride.routeId || undefined,
                rideId: ride._id?.toString(),
                text: `${user.name || user.username || 'Bir sürücü'} '${ride.title}' sürüşüne katıldı.`
            }).catch(err => console.warn('[GroupRide] Notification join error:', err.message));
        }

        return respond({
            success: true,
            message: 'Sürüşe başarıyla katıldınız!',
            participantsCount: ride.participants.length + 1
        },200);
    } catch (error) { throw error; }

    return response;
};

export const leaveGroupRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { id } = input.params;
        const userId = input.user._id.toString();

        const ride = await GroupRide.findById(id);
        if (!ride) {
            return raiseHttpError({ success: false, error: 'Sürüş bulunamadı.' },404);
        }

        if (ride.organizer?.userId?.toString() === userId) {
            if (ride.participants.length > 0) {
                const nextOrganizer = ride.participants[0];
                ride.organizer = {
                    userId: nextOrganizer.userId,
                    name: nextOrganizer.name,
                    avatar: nextOrganizer.avatar,
                    bike: nextOrganizer.bike
                };
                ride.participants.splice(0, 1);
                await ride.save();

                return respond({
                    success: true,
                    message: `Organizatörlük ${nextOrganizer.name || 'ilk katılımcıya'} devredildi; sürüşten ayrıldınız.`,
                    participantsCount: ride.participants.length + 1,
                    organizerTransferred: true
                },200);
            }

            ride.status = 'cancelled';
            await ride.save();
            return respond({
                success: true,
                message: 'Katılımcı olmadığı için sürüş iptal edildi.',
                participantsCount: 0,
                rideCancelled: true
            },200);
        }

        const updatedRide = await GroupRide.findOneAndUpdate(
            { _id: id, 'participants.userId': input.user._id },
            { $pull: { participants: { userId: input.user._id } } },
            { new: true }
        ).select('_id participants');

        if (!updatedRide) {
            return raiseHttpError({
                success: false,
                error: 'Bu sürüşte aktif bir katılım kaydınız bulunamadı.'
            },409);
        }

        return respond({
            success: true,
            message: 'Sürüş katılımı iptal edildi.',
            participantsCount: updatedRide.participants.length + 1
        },200);
    } catch (error) { throw error; }

    return response;
};

export const toggleGroupLiveRadar = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { id } = input.params;
        const userId = input.user._id.toString();

        const ride = await GroupRide.findById(id);
        if (!ride) {
            return raiseHttpError({ success: false, error: 'Sürüş bulunamadı.' },404);
        }

        // Yalnızca organizatör başlatabilir
        if (ride.organizer.userId.toString() !== userId) {
            return raiseHttpError({ success: false, error: 'Canlı radar oturumunu sadece sürüş lideri yönetebilir.' },403);
        }

        ride.liveRadar.isActive = !ride.liveRadar.isActive;
        if (ride.liveRadar.isActive) {
            ride.liveRadar.startedAt = new Date();
            ride.liveRadar.channelId = `ride_radar_${id}`;
            ride.status = 'active';
        } else {
            ride.status = 'completed';
        }

        await ride.save();
        return respond({ success: true, liveRadar: ride.liveRadar, status: ride.status },200);
    } catch (error) { throw error; }

    return response;
};
