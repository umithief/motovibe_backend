import MeetupEvent from './model.js';
import mongoose from 'mongoose';

import User from "../users/model.js";

import { evaluateAndUnlock } from "../achievements/service.js";
import { notifyTextMentions } from "../notifications/mention.service.js";

import { getIO } from '../../socket.js';

const broadcastSocket = (room, eventName, payload) => {
    try {
        const io = getIO();
        if (room) {
            io.to(room).emit(eventName, payload);
        } else {
            io.emit(eventName, payload);
        }
    } catch (_) {
        // Socket offline or uninitialized
    }
};

const result = (body, statusCode = 200) => ({ body, statusCode });

export const listEvents = async (input) => {
        const { type, routeType, pace, difficulty, upcoming, past, featured, search, sort, limit, page, status } = input.query;
        const currentUserId = (input.user?.id || input.user?._id || input.query.userId || '').toString();

        let filter = {};

        // Statü filtresi
        if (status && status !== 'all') {
            filter.status = status;
        }

        // Tip filtresi
        if (type && type !== 'all') {
            filter.type = type;
        }

        // Rota karakteri ve tempo filtresi
        if (routeType && routeType !== 'all') {
            filter.routeType = routeType;
        }
        if (pace && pace !== 'all') {
            filter.pace = pace;
        }
        if (difficulty && difficulty !== 'all') {
            filter.difficulty = difficulty;
        }

        // Öne çıkan filtresi
        if (featured === 'true') {
            filter.isFeatured = true;
        }

        // İptal edilmemişleri göster (default)
        if (input.query.includeCancelled !== 'true') {
            filter.isCancelled = { $ne: true };
        }

        // Tarih filtresi (Bugünün tarihi YYYY-MM-DD)
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        if (upcoming === 'true') {
            filter.date = { $gte: todayStr };
        } else if (past === 'true') {
            filter.date = { $lt: todayStr };
        }

        // Kullanıcının kendi etkinlikleri
        if (currentUserId && input.query.myEvents === 'true') {
            filter.$or = [
                { organizer: currentUserId },
                { organizerId: currentUserId },
                { 'attendeeList.userId': currentUserId }
            ];
        }

        // Arama (Başlık, konum, organizatör, açıklama)
        if (search) {
            const searchFilter = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } },
                { meetingPoint: { $regex: search, $options: 'i' } },
                { organizer: { $regex: search, $options: 'i' } },
                { organizerName: { $regex: search, $options: 'i' } },
                { tags: { $in: [new RegExp(search, 'i')] } },
            ];
            if (filter.$or) {
                filter = { $and: [{ $or: filter.$or }, { $or: searchFilter }] };
            } else {
                filter.$or = searchFilter;
            }
        }

        // Sıralama
        let sortObj = { date: 1, time: 1 };
        if (sort === 'date_asc') sortObj = { date: 1, time: 1 };
        if (sort === 'date_desc') sortObj = { date: -1, time: -1 };
        if (sort === 'popular') sortObj = { attendees: -1 };
        if (sort === 'newest') sortObj = { createdAt: -1 };

        // Pagination
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;
        const skip = (pageNum - 1) * limitNum;

        const rawEvents = await MeetupEvent.find(filter)
            .select('-messages -routeCoordinates -liveGroupRide.activeRiders')
            .sort(sortObj)
            .skip(skip)
            .limit(limitNum);

        const total = await MeetupEvent.countDocuments(filter);

        // Dinamik isJoined hesabı ile istemciye eksiksiz aktarım
        const events = rawEvents.map((event) => {
            const doc = event.toObject({ virtuals: true });
            doc.isJoined = currentUserId
                ? (doc.attendeeList || []).some(
                    (a) => (a.userId || a.id || a._id)?.toString() === currentUserId
                  )
                : false;
            return doc;
        });

        return result({
            events,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            }
        }, 200);

};

export const getEventStats = async (input) => {
        const todayStr = new Date().toISOString().slice(0, 10);

        // Gelecek cumartesi ve pazar tarihlerini hesapla
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0: Pazar, 6: Cts
        const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
        const saturday = new Date(now);
        saturday.setDate(now.getDate() + daysUntilSaturday);
        const sunday = new Date(saturday);
        sunday.setDate(saturday.getDate() + 1);

        const satStr = saturday.toISOString().slice(0, 10);
        const sunStr = sunday.toISOString().slice(0, 10);

        const [activeEvents, weekendCount, totalRidersAgg] = await Promise.all([
            MeetupEvent.countDocuments({ date: { $gte: todayStr }, isCancelled: { $ne: true } }),
            MeetupEvent.countDocuments({ date: { $in: [satStr, sunStr] }, isCancelled: { $ne: true } }),
            MeetupEvent.aggregate([
                { $match: { isCancelled: { $ne: true } } },
                { $group: { _id: null, total: { $sum: '$attendees' } } }
            ])
        ]);

        const totalRiders = (totalRidersAgg && totalRidersAgg[0]?.total) || 0;

        return result({
            totalActive: activeEvents,
            thisWeekend: weekendCount,
            totalRiders: totalRiders,
        }, 200);

};

export const getFeaturedEvents = async (input) => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const events = await MeetupEvent.find({
            isFeatured: true,
            isCancelled: { $ne: true },
            date: { $gte: todayStr }
        })
            .select('-messages -routeCoordinates -liveGroupRide.activeRiders')
            .sort({ date: 1, time: 1 })
            .limit(10);
        return result(events, 200);

};

export const getMyEvents = async (input) => {
        const userId = input.user?.id || input.user?._id?.toString() || input.query.userId;

        if (!userId) {
            return result({ message: 'Kullanıcı kimliği gerekli.' }, 400);
        }

        const events = await MeetupEvent.find({
            $or: [
                { organizer: userId },
                { organizerId: userId },
                { 'attendeeList.userId': userId }
            ]
        })
        .select('-messages -routeCoordinates -liveGroupRide.activeRiders')
        .sort({ date: -1, time: -1 });

        return result(events, 200);

};

export const getEvent = async (input) => {
        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        const currentUserId = (input.user?.id || input.user?._id || input.query.userId || '').toString();
        const doc = event.toObject({ virtuals: true });
        doc.isJoined = currentUserId
            ? (doc.attendeeList || []).some(
                (a) => (a.userId || a.id || a._id)?.toString() === currentUserId
              )
            : false;

        return result(doc, 200);

};

export const createEvent = async (input) => {
        const eventData = { ...input.body };

        const requesterId = (input.user?._id || input.user?.id || eventData.creator || eventData.organizerId || '').toString();
        const requesterName = input.user?.name || input.user?.username || eventData.organizer || 'MotoVibe Rider';
        const requesterAvatar = input.user?.avatar || eventData.organizerAvatar || '';

        eventData.organizer = requesterName;
        eventData.organizerId = requesterId;
        eventData.organizerName = requesterName;
        eventData.organizerAvatar = requesterAvatar;

        // Koordinat kontrolü ve varsayılan değer
        if (!eventData.coordinates || typeof eventData.coordinates.lat !== 'number' || typeof eventData.coordinates.lng !== 'number') {
            eventData.coordinates = {
                lat: Number(eventData.coordinates?.lat) || 41.0082,
                lng: Number(eventData.coordinates?.lng) || 28.9784,
            };
        }

        // Kapak görseli varsayılanı
        if (!eventData.image || eventData.image.trim().length === 0) {
            eventData.image = 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1200&q=80';
        }

        // Sürüşü oluşturan sürücüyü otomatik ilk katılımcı yap
        if (requesterId) {
            eventData.attendeeList = [{
                userId: requesterId,
                name: requesterName,
                avatar: requesterAvatar,
                joinedAt: new Date()
            }];
            eventData.attendees = 1;
        }

        const newEvent = new MeetupEvent(eventData);
        await newEvent.save();

        const doc = newEvent.toObject({ virtuals: true });
        doc.isJoined = true;

        // Canlı bildirim (Socket)
        broadcastSocket(null, 'new_group_ride_created', { event: doc });

        // Başarım sistemine işlet
        if (requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
            try {
                const userForEvent = await User.findById(requesterId);
                if (userForEvent) {
                    const eventsCreated = (userForEvent.achievementProgress && userForEvent.achievementProgress.get('eventsCreated')) || 0;
                    if (!userForEvent.achievementProgress) userForEvent.achievementProgress = new Map();
                    userForEvent.achievementProgress.set('eventsCreated', eventsCreated + 1);
                    await userForEvent.save({ validateBeforeSave: false });
                    evaluateAndUnlock(requesterId).catch(err => console.error('[Event Achievement Error]:', err));
                }
            } catch (achErr) {
                console.error('[Event Achievement Progress Error]:', achErr);
            }
        }

        return result({
            success: true,
            event: doc,
            ...doc
        }, 201);

};

export const updateEvent = async (input) => {
        const event = await MeetupEvent.findById(input.params.id);

        if (!event) {
            return result({ message: 'Etkinlik bulunamadı' }, 404);
        }

        // Sadece organizatör veya admin düzenleyebilir
        const requesterId = (input.user?.id || input.user?._id || '').toString();
        const isOrganizer =
            event.organizer === requesterId ||
            event.organizerId?.toString() === requesterId ||
            (input.body.organizer && input.body.organizer === requesterId) ||
            input.user?.role === 'admin';

        if (!isOrganizer) {
            return result({ message: 'Yalnızca organizatör düzenleyebilir.' }, 403);
        }

        const updatedEvent = await MeetupEvent.findByIdAndUpdate(
            input.params.id,
            input.body,
            { new: true, runValidators: true }
        );
        return result(updatedEvent, 200);

};

export const deleteEvent = async (input) => {
        const event = await MeetupEvent.findById(input.params.id);

        if (!event) {
            return result({ message: 'Etkinlik bulunamadı' }, 404);
        }

        // Sadece organizatör veya admin silebilir
        const requesterId = (input.user?.id || input.user?._id || '').toString();
        const isOrganizer =
            event.organizer === requesterId ||
            event.organizerId?.toString() === requesterId ||
            input.user?.role === 'admin';

        if (!isOrganizer) {
            return result({ message: 'Yalnızca organizatör veya yönetici silebilir.' }, 403);
        }

        await MeetupEvent.findByIdAndDelete(input.params.id);
        return result({ message: 'Etkinlik silindi' }, 200);

};

export const cancelEvent = async (input) => {
        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        // Sadece organizatör veya admin iptal edebilir
        const requesterId = (input.user?.id || input.user?._id || '').toString();
        const isOrganizer =
            event.organizer === requesterId ||
            event.organizerId?.toString() === requesterId ||
            input.user?.role === 'admin';

        if (!isOrganizer) {
            return result({ message: 'Yalnızca organizatör etkinliği iptal edebilir.' }, 403);
        }

        event.isCancelled = true;
        await event.save();
        return result(event, 200);

};

export const joinEvent = async (input) => {
        const body = input.body || {};
        const userId = (body.userId || input.user?.id || input.user?._id || '').toString();
        const name = (body.name || input.user?.name || input.user?.username || 'MotoVibe Rider').toString();
        const avatar = (body.avatar || input.user?.avatar || '').toString();

        if (!userId) {
            return result({ message: 'Katılım için kullanıcı kimliği gerekli.' }, 400);
        }

        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        if (event.isCancelled) {
            return result({ message: 'İptal edilmiş etkinliğe katılamazsınız.' }, 400);
        }

        // Kapasite kontrolü
        if (event.maxAttendees > 0 && event.attendeeList.length >= event.maxAttendees) {
            return result({ message: 'Etkinlik kapasitesi dolu.' }, 400);
        }

        const isAlreadyJoined = event.attendeeList.some((a) => (a.userId || a.id)?.toString() === userId);
        if (!isAlreadyJoined) {
            event.attendeeList.push({ userId, name, avatar, joinedAt: new Date() });
            event.attendees = event.attendeeList.length;
            await event.save();

            // Gerçek zamanlı Socket bildirimi
            broadcastSocket(`event_${event._id}`, 'event_participant_joined', {
                eventId: event._id.toString(),
                attendee: { userId, name, avatar },
                attendees: event.attendees
            });
            broadcastSocket(null, 'event_attendees_updated', {
                eventId: event._id.toString(),
                attendees: event.attendees
            });

            // Başarım ilerlemesi
            if (userId && mongoose.Types.ObjectId.isValid(userId)) {
                try {
                    const rider = await User.findById(userId);
                    if (rider) {
                        const attended = (rider.achievementProgress && rider.achievementProgress.get('eventsAttended')) || 0;
                        if (!rider.achievementProgress) rider.achievementProgress = new Map();
                        rider.achievementProgress.set('eventsAttended', attended + 1);
                        await rider.save({ validateBeforeSave: false });
                        evaluateAndUnlock(userId).catch(err => console.error('[Event Join Achievement Error]:', err));
                    }
                } catch (achErr) {
                    console.error('[Event Join Progress Error]:', achErr);
                }
            }
        }

        const doc = event.toObject({ virtuals: true });
        doc.isJoined = true;
        return result({
            success: true,
            isJoined: true,
            attendees: event.attendees,
            event: doc,
            ...doc
        }, 200);

};

export const leaveEvent = async (input) => {
        const body = input.body || {};
        const userId = (body.userId || input.user?.id || input.user?._id || '').toString();

        if (!userId) {
            return result({ message: 'Ayrılmak için kullanıcı kimliği gerekli.' }, 400);
        }

        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        event.attendeeList = event.attendeeList.filter((a) => (a.userId || a.id)?.toString() !== userId);
        event.attendees = event.attendeeList.length;
        await event.save();

        // Gerçek zamanlı Socket bildirimi
        broadcastSocket(`event_${event._id}`, 'event_participant_left', {
            eventId: event._id.toString(),
            userId,
            attendees: event.attendees
        });
        broadcastSocket(null, 'event_attendees_updated', {
            eventId: event._id.toString(),
            attendees: event.attendees
        });

        const doc = event.toObject({ virtuals: true });
        doc.isJoined = false;
        return result({
            success: true,
            isJoined: false,
            attendees: event.attendees,
            event: doc,
            ...doc
        }, 200);

};

export const startEvent = async (input) => {
        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        const requesterId = (input.user?.id || input.user?._id || input.body.userId || '').toString();
        const isOrganizer =
            event.organizer === requesterId ||
            event.organizerId?.toString() === requesterId ||
            input.user?.role === 'admin';

        if (!isOrganizer) {
            return result({ message: 'Yalnızca organizatör sürüşü başlatabilir.' }, 403);
        }

        event.status = 'active';
        if (!event.liveGroupRide) {
            event.liveGroupRide = { isActive: true, startedAt: new Date(), activeRiders: [] };
        } else {
            event.liveGroupRide.isActive = true;
            event.liveGroupRide.startedAt = new Date();
            event.liveGroupRide.currentLeader = requesterId;
        }

        await event.save();

        broadcastSocket(`event_${event._id}`, 'group_ride_started', {
            eventId: event._id.toString(),
            startedAt: event.liveGroupRide.startedAt,
            leaderId: requesterId
        });

        return result({
            success: true,
            status: 'active',
            message: 'Grup sürüşü canlı olarak başlatıldı.',
            liveGroupRide: event.liveGroupRide
        }, 200);

};

export const finishEvent = async (input) => {
        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        const requesterId = (input.user?.id || input.user?._id || input.body.userId || '').toString();
        const isOrganizer =
            event.organizer === requesterId ||
            event.organizerId?.toString() === requesterId ||
            input.user?.role === 'admin';

        if (!isOrganizer) {
            return result({ message: 'Yalnızca organizatör sürüşü sonlandırabilir.' }, 403);
        }

        event.status = 'completed';
        if (event.liveGroupRide) {
            event.liveGroupRide.isActive = false;
            event.liveGroupRide.finishedAt = new Date();
        }

        await event.save();

        broadcastSocket(`event_${event._id}`, 'group_ride_finished', {
            eventId: event._id.toString(),
            finishedAt: event.liveGroupRide?.finishedAt || new Date()
        });

        return result({
            success: true,
            status: 'completed',
            message: 'Grup sürüşü başarıyla tamamlandı.',
            liveGroupRide: event.liveGroupRide
        }, 200);

};

export const updateEventLocation = async (input) => {
        const { userId, name, avatar, lat, lng, speed, heading } = input.body;
        const riderId = (userId || input.user?.id || input.user?._id || '').toString();

        if (!riderId || lat == null || lng == null) {
            return result({ message: 'Eksik telemetri veya konum bilgisi.' }, 400);
        }

        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        const riderData = {
            userId: riderId,
            name: name || input.user?.name || input.user?.username || 'Rider',
            avatar: avatar || input.user?.avatar || '',
            lat: Number(lat),
            lng: Number(lng),
            speed: Number(speed) || 0,
            heading: Number(heading) || 0,
            updatedAt: new Date()
        };

        if (!event.liveGroupRide) {
            event.liveGroupRide = { isActive: true, startedAt: new Date(), activeRiders: [riderData] };
        } else {
            const existingIdx = (event.liveGroupRide.activeRiders || []).findIndex(
                (r) => r.userId === riderId
            );
            if (existingIdx > -1) {
                event.liveGroupRide.activeRiders[existingIdx] = riderData;
            } else {
                event.liveGroupRide.activeRiders.push(riderData);
            }
        }

        await event.save();

        // Diğer grup üyelerine canlı konumu ilet
        broadcastSocket(`event_${event._id}`, 'group_rider_position_update', {
            eventId: event._id.toString(),
            rider: riderData
        });

        return result({ success: true, rider: riderData }, 200);

};

export const getEventLive = async (input) => {
        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        return result({
            eventId: event._id,
            status: event.status,
            isActive: event.liveGroupRide?.isActive || false,
            startedAt: event.liveGroupRide?.startedAt,
            currentLeader: event.liveGroupRide?.currentLeader,
            activeRiders: event.liveGroupRide?.activeRiders || [],
            attendees: event.attendees
        }, 200);

};

export const sendEventMessage = async (input) => {
        const body = input.body || {};
        const userId = (body.userId || input.user?.id || '').toString();
        const userName = (body.userName || body.name || input.user?.name || input.user?.username || 'MotoVibe Rider').toString();
        const userAvatar = (body.userAvatar || body.avatar || input.user?.avatar || '').toString();
        const text = (body.text || '').toString().trim();
        const time = body.time;

        if (!userId) {
            return result({ message: 'Mesaj için kullanıcı kimliği gerekli.' }, 400);
        }

        if (!text) {
            return result({ message: 'Mesaj metni boş olamaz.' }, 400);
        }

        const event = await MeetupEvent.findById(input.params.id);
        if (!event) return result({ message: 'Etkinlik bulunamadı' }, 404);

        const newMessage = {
            id: new mongoose.Types.ObjectId().toString(),
            userId,
            userName,
            userAvatar,
            text,
            time:
                time ||
                new Date().toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                }),
            createdAt: new Date(),
        };

        event.messages.push(newMessage);
        await event.save();

        broadcastSocket(`event_${event._id}`, 'receive_event_message', newMessage);

        // Only token-authenticated senders may trigger notifications; the
        // body `userId` is client-supplied and cannot be trusted as the actor.
        if (input.user?.id && text.includes('@')) {
            notifyTextMentions({
                text,
                actorId: input.user.id,
                type: 'MENTIONED_IN_EVENT',
                refs: { relatedId: event._id.toString() },
            });
        }

        return result(newMessage, 201);

};
