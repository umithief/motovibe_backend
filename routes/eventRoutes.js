import express from 'express';
import mongoose from 'mongoose';
import { checkUser, protect } from '../middleware/authMiddleware.js';
import User from '../models/User.js';
import { evaluateAndUnlock } from '../services/achievementEngine.js';
import { getIO } from '../socket.js';

const router = express.Router();

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

// GET /api/events — Tüm etkinlikleri getir (filtreleme + dinamik isJoined hesabı + arama)
router.get('/', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const { type, routeType, pace, difficulty, upcoming, past, featured, search, sort, limit, page, status } = req.query;
        const currentUserId = (req.user?.id || req.user?._id || req.query.userId || '').toString();
        
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
        if (req.query.includeCancelled !== 'true') {
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
        if (currentUserId && req.query.myEvents === 'true') {
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

        res.json({
            events,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/events/stats — Etkinlik ve sürüş telemetri istatistikleri
router.get('/stats', async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
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

        res.json({
            totalActive: activeEvents,
            thisWeekend: weekendCount,
            totalRiders: totalRiders,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/events/featured — Öne çıkan etkinlikler
router.get('/featured', async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const todayStr = new Date().toISOString().slice(0, 10);
        const events = await MeetupEvent.find({ 
            isFeatured: true, 
            isCancelled: { $ne: true },
            date: { $gte: todayStr }
        })
            .sort({ date: 1, time: 1 })
            .limit(10);
        res.json(events);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/events/my — Kullanıcının katıldığı/oluşturduğu etkinlikler
router.get('/my', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const userId = req.user?.id || req.user?._id?.toString() || req.query.userId;
        
        if (!userId) {
            return res.status(400).json({ message: 'Kullanıcı kimliği gerekli.' });
        }

        const events = await MeetupEvent.find({
            $or: [
                { organizer: userId },
                { organizerId: userId },
                { 'attendeeList.userId': userId }
            ]
        }).sort({ date: -1, time: -1 });

        res.json(events);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/events/:id
router.get('/:id', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

        const currentUserId = (req.user?.id || req.user?._id || req.query.userId || '').toString();
        const doc = event.toObject({ virtuals: true });
        doc.isJoined = currentUserId
            ? (doc.attendeeList || []).some(
                (a) => (a.userId || a.id || a._id)?.toString() === currentUserId
              )
            : false;

        res.json(doc);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events
router.post('/', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const eventData = { ...req.body };

        const requesterId = (req.user?._id || req.user?.id || eventData.creator || eventData.organizerId || '').toString();
        const requesterName = req.user?.name || req.user?.username || eventData.organizer || 'MotoVibe Rider';
        const requesterAvatar = req.user?.avatar || eventData.organizerAvatar || '';

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

        res.status(201).json({
            success: true,
            event: doc,
            ...doc
        });
    } catch (error) {
        console.error('Create Event Error:', error);
        res.status(400).json({ message: error.message });
    }
});

// PUT /api/events/:id
router.put('/:id', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const event = await MeetupEvent.findById(req.params.id);
        
        if (!event) {
            return res.status(404).json({ message: 'Etkinlik bulunamadı' });
        }

        // Sadece organizatör veya admin düzenleyebilir
        const requesterId = (req.user?.id || req.user?._id || '').toString();
        const isOrganizer = 
            event.organizer === requesterId || 
            event.organizerId?.toString() === requesterId ||
            (req.body.organizer && req.body.organizer === requesterId) ||
            req.user?.role === 'admin';

        if (!isOrganizer) {
            return res.status(403).json({ message: 'Yalnızca organizatör düzenleyebilir.' });
        }

        const updatedEvent = await MeetupEvent.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        res.json(updatedEvent);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE /api/events/:id
router.delete('/:id', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const event = await MeetupEvent.findById(req.params.id);
        
        if (!event) {
            return res.status(404).json({ message: 'Etkinlik bulunamadı' });
        }

        // Sadece organizatör veya admin silebilir
        const requesterId = (req.user?.id || req.user?._id || '').toString();
        const isOrganizer = 
            event.organizer === requesterId || 
            event.organizerId?.toString() === requesterId ||
            req.user?.role === 'admin';

        if (!isOrganizer) {
            return res.status(403).json({ message: 'Yalnızca organizatör veya yönetici silebilir.' });
        }

        await MeetupEvent.findByIdAndDelete(req.params.id);
        res.json({ message: 'Etkinlik silindi' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events/:id/cancel — Etkinliği iptal et
router.post('/:id/cancel', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

        // Sadece organizatör veya admin iptal edebilir
        const requesterId = (req.user?.id || req.user?._id || '').toString();
        const isOrganizer = 
            event.organizer === requesterId || 
            event.organizerId?.toString() === requesterId ||
            req.user?.role === 'admin';

        if (!isOrganizer) {
            return res.status(403).json({ message: 'Yalnızca organizatör etkinliği iptal edebilir.' });
        }

        event.isCancelled = true;
        await event.save();
        res.json(event);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events/:id/join
router.post('/:id/join', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const body = req.body || {};
        const userId = (body.userId || req.user?.id || req.user?._id || '').toString();
        const name = (body.name || req.user?.name || req.user?.username || 'MotoVibe Rider').toString();
        const avatar = (body.avatar || req.user?.avatar || '').toString();

        if (!userId) {
            return res.status(400).json({ message: 'Katılım için kullanıcı kimliği gerekli.' });
        }

        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

        if (event.isCancelled) {
            return res.status(400).json({ message: 'İptal edilmiş etkinliğe katılamazsınız.' });
        }

        // Kapasite kontrolü
        if (event.maxAttendees > 0 && event.attendeeList.length >= event.maxAttendees) {
            return res.status(400).json({ message: 'Etkinlik kapasitesi dolu.' });
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
        res.json({
            success: true,
            isJoined: true,
            attendees: event.attendees,
            event: doc,
            ...doc
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events/:id/leave
router.post('/:id/leave', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const body = req.body || {};
        const userId = (body.userId || req.user?.id || req.user?._id || '').toString();

        if (!userId) {
            return res.status(400).json({ message: 'Ayrılmak için kullanıcı kimliği gerekli.' });
        }

        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

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
        res.json({
            success: true,
            isJoined: false,
            attendees: event.attendees,
            event: doc,
            ...doc
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events/:id/start — Grup sürüşünü canlı başlat (Organizatör)
router.post('/:id/start', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

        const requesterId = (req.user?.id || req.user?._id || req.body.userId || '').toString();
        const isOrganizer = 
            event.organizer === requesterId || 
            event.organizerId?.toString() === requesterId || 
            req.user?.role === 'admin';

        if (!isOrganizer) {
            return res.status(403).json({ message: 'Yalnızca organizatör sürüşü başlatabilir.' });
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

        res.json({
            success: true,
            status: 'active',
            message: 'Grup sürüşü canlı olarak başlatıldı.',
            liveGroupRide: event.liveGroupRide
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events/:id/finish — Grup sürüşünü tamamla (Organizatör)
router.post('/:id/finish', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

        const requesterId = (req.user?.id || req.user?._id || req.body.userId || '').toString();
        const isOrganizer = 
            event.organizer === requesterId || 
            event.organizerId?.toString() === requesterId || 
            req.user?.role === 'admin';

        if (!isOrganizer) {
            return res.status(403).json({ message: 'Yalnızca organizatör sürüşü sonlandırabilir.' });
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

        res.json({
            success: true,
            status: 'completed',
            message: 'Grup sürüşü başarıyla tamamlandı.',
            liveGroupRide: event.liveGroupRide
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events/:id/live-location — Canlı grup sürüşünde sürücü telemetrisi & konum yayını
router.post('/:id/live-location', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const { userId, name, avatar, lat, lng, speed, heading } = req.body;
        const riderId = (userId || req.user?.id || req.user?._id || '').toString();

        if (!riderId || lat == null || lng == null) {
            return res.status(400).json({ message: 'Eksik telemetri veya konum bilgisi.' });
        }

        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

        const riderData = {
            userId: riderId,
            name: name || req.user?.name || req.user?.username || 'Rider',
            avatar: avatar || req.user?.avatar || '',
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

        res.json({ success: true, rider: riderData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/events/:id/live — Canlı grup sürüşü durumu ve aktif sürücüler
router.get('/:id/live', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

        res.json({
            eventId: event._id,
            status: event.status,
            isActive: event.liveGroupRide?.isActive || false,
            startedAt: event.liveGroupRide?.startedAt,
            currentLeader: event.liveGroupRide?.currentLeader,
            activeRiders: event.liveGroupRide?.activeRiders || [],
            attendees: event.attendees
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/events/:id/message
router.post('/:id/message', checkUser, async (req, res) => {
    try {
        const MeetupEvent = mongoose.model('MeetupEvent');
        const body = req.body || {};
        const userId = (body.userId || req.user?.id || '').toString();
        const userName = (body.userName || body.name || req.user?.name || req.user?.username || 'MotoVibe Rider').toString();
        const userAvatar = (body.userAvatar || body.avatar || req.user?.avatar || '').toString();
        const text = (body.text || '').toString().trim();
        const time = body.time;

        if (!userId) {
            return res.status(400).json({ message: 'Mesaj için kullanıcı kimliği gerekli.' });
        }

        if (!text) {
            return res.status(400).json({ message: 'Mesaj metni boş olamaz.' });
        }

        const event = await MeetupEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Etkinlik bulunamadı' });

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

        res.status(201).json(newMessage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;