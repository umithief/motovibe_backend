import GroupRide from '../models/GroupRide.js';
import Route from '../models/Route.js';
import User from '../models/User.js';
import { createNotification } from './notificationController.js';

// Default Route Events Seeds if database has 0 group rides
const SEED_GROUP_RIDES = [
    {
        title: 'Şile Sahil Virajları & Sabah Gazlaması',
        description: 'Cumartesi sabahı erken saatte Şile eski sahil yolunun teknik virajlarını akıcı bir tempoda dönüyoruz. Kahve ve kahvaltı molası Saklıgöl’de.',
        coverImage: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1200&q=80',
        date: '2026-09-20',
        time: '08:30',
        meetingPoint: 'Çekmeköy Shell İstasyonu (Şile Yolu Çıkışı)',
        coordinates: { lat: 41.0345, lng: 29.1834 },
        pace: 'spirited',
        difficulty: 'hard',
        minCcRequirement: 400,
        distance: '94 km',
        estimatedDuration: '2 saat 15 dk',
        maxParticipants: 15,
        status: 'scheduled',
        waypoints: [
            { name: 'Buluşma: Çekmeköy Shell', lat: 41.0345, lng: 29.1834, type: 'start', order: 1 },
            { name: 'Ömerli Barajı Seyir Tepesi', lat: 41.0621, lng: 29.3412, type: 'scenic', order: 2 },
            { name: 'Şile Saklıgöl Kahvaltı', lat: 41.1420, lng: 29.5830, type: 'cafe', order: 3 },
            { name: 'Ağva Sahil Bitiş', lat: 41.1378, lng: 29.8456, type: 'end', order: 4 }
        ],
        routeCoordinates: [
            { lat: 41.0345, lng: 29.1834 },
            { lat: 41.0450, lng: 29.2300 },
            { lat: 41.0621, lng: 29.3412 },
            { lat: 41.0980, lng: 29.4500 },
            { lat: 41.1420, lng: 29.5830 },
            { lat: 41.1378, lng: 29.8456 }
        ]
    },
    {
        title: 'Boğaz Hattı & Rumeli Feneri Gece Sürüşü',
        description: 'Hafta içi stresini atmak için Beşiktaş’tan Sarıyer sırtlarına, oradan Rumeli Feneri sisli virajlarına gece sürüşü. Sakin ve keyifli tempo.',
        coverImage: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=1200&q=80',
        date: '2026-09-22',
        time: '21:00',
        meetingPoint: 'Kuruçeşme Parkı Otoparkı',
        coordinates: { lat: 41.0592, lng: 29.0341 },
        pace: 'chill',
        difficulty: 'easy',
        minCcRequirement: 125,
        distance: '48 km',
        estimatedDuration: '1 saat 45 dk',
        maxParticipants: 25,
        status: 'scheduled',
        waypoints: [
            { name: 'Kuruçeşme Parkı', lat: 41.0592, lng: 29.0341, type: 'start', order: 1 },
            { name: 'Tarabya Sahil Molası', lat: 41.1390, lng: 29.0560, type: 'cafe', order: 2 },
            { name: 'Rumeli Feneri Kale Noktası', lat: 41.2350, lng: 29.1410, type: 'end', order: 3 }
        ],
        routeCoordinates: [
            { lat: 41.0592, lng: 29.0341 },
            { lat: 41.0850, lng: 29.0490 },
            { lat: 41.1390, lng: 29.0560 },
            { lat: 41.1850, lng: 29.0800 },
            { lat: 41.2350, lng: 29.1410 }
        ]
    },
    {
        title: 'Tekirdağ Uçmakdere Viraj Seansı',
        description: 'Marmara Denizi manzaralı Uçmakdere yamaç paraşütü iniş pistine inen efsanevi virajlar. Orta-yüksek tempo, teknik viraj tecrübesi gerektirir.',
        coverImage: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1200&q=80',
        date: '2026-09-27',
        time: '07:30',
        meetingPoint: 'Kınalı Gişeler Opet Tesisleri',
        coordinates: { lat: 41.0821, lng: 28.1432 },
        pace: 'spirited',
        difficulty: 'expert',
        minCcRequirement: 500,
        distance: '165 km',
        estimatedDuration: '3 saat 30 dk',
        maxParticipants: 12,
        status: 'scheduled',
        waypoints: [
            { name: 'Kınalı Opet', lat: 41.0821, lng: 28.1432, type: 'start', order: 1 },
            { name: 'Yeniköy Çay Bahçesi', lat: 40.8520, lng: 27.5640, type: 'cafe', order: 2 },
            { name: 'Uçmakdere Zirve Seyir', lat: 40.7980, lng: 27.3650, type: 'summit', order: 3 },
            { name: 'Kumbağ Sahil', lat: 40.8710, lng: 27.4620, type: 'end', order: 4 }
        ],
        routeCoordinates: [
            { lat: 41.0821, lng: 28.1432 },
            { lat: 40.9700, lng: 27.8500 },
            { lat: 40.8520, lng: 27.5640 },
            { lat: 40.7980, lng: 27.3650 }
        ]
    }
];

export const getGroupRides = async (req, res) => {
    try {
        const { filter = 'all', pace, difficulty, search } = req.query;
        const currentUserId = req.user?._id?.toString() || req.query.userId || '';

        // Otomatik tohumlama (Eğer veritabanı tamamen boşsa)
        const count = process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_DATA === 'true'
            ? await GroupRide.countDocuments() : -1;
        if (count === 0) {
            let adminUser = await User.findOne({ isAdmin: true });
            if (!adminUser) adminUser = await User.findOne();

            const seeds = SEED_GROUP_RIDES.map(s => ({
                ...s,
                organizer: {
                    userId: adminUser?._id || new mongoose.Types.ObjectId(),
                    name: adminUser?.name || 'Motonom Lead Rider',
                    avatar: adminUser?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
                    bike: 'Ducati Multistrada V4 Pikes Peak'
                }
            }));
            await GroupRide.insertMany(seeds);
        }

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

        return res.status(200).json({
            success: true,
            count: formattedRides.length,
            rides: formattedRides
        });
    } catch (error) {
        console.error('[getGroupRides Error]:', error);
        return res.status(500).json({ success: false, error: 'Sürüş etkinlikleri getirilemedi.' });
    }
};

export const getGroupRideById = async (req, res) => {
    try {
        const { id } = req.params;
        const currentUserId = req.user?._id?.toString() || '';

        const ride = await GroupRide.findById(id).populate('routeId');
        if (!ride) {
            return res.status(404).json({ success: false, error: 'Sürüş etkinliği bulunamadı.' });
        }

        const obj = ride.toObject();
        const isJoined = currentUserId
            ? (obj.organizer?.userId?.toString() === currentUserId ||
               obj.participants?.some(p => p.userId?.toString() === currentUserId))
            : false;

        return res.status(200).json({
            success: true,
            ride: {
                ...obj,
                isJoined,
                participantsCount: (obj.participants?.length || 0) + 1
            }
        });
    } catch (error) {
        console.error('[getGroupRideById Error]:', error);
        return res.status(500).json({ success: false, error: 'Sürüş detayı getirilemedi.' });
    }
};

export const createGroupRide = async (req, res) => {
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
        } = req.body;

        if (!title || !date || !time || !meetingPoint) {
            return res.status(400).json({
                success: false,
                error: 'Başlık, tarih, saat ve buluşma noktası alanları zorunludur.'
            });
        }

        const user = req.user;
        const organizer = {
            userId: user._id,
            name: user.name || user.username || 'Motonom Pilotu',
            avatar: user.avatar || '',
            bike: req.body.bike || ''
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
        return res.status(201).json({ success: true, ride: newRide });
    } catch (error) {
        console.error('[createGroupRide Error]:', error);
        return res.status(500).json({ success: false, error: 'Sürüş etkinliği oluşturulamadı.' });
    }
};

export const joinGroupRide = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const ride = await GroupRide.findById(id);
        if (!ride) {
            return res.status(404).json({ success: false, error: 'Sürüş bulunamadı.' });
        }

        // Kapasite kontrolü
        if (ride.maxParticipants > 0 && ride.participants.length >= ride.maxParticipants) {
            return res.status(400).json({ success: false, error: 'Bu sürüşün kontenjanı dolmuştur.' });
        }

        // Zaten katılmış mı kontrolü
        const isAlreadyJoined = ride.participants.some(p => p.userId.toString() === user._id.toString()) ||
                               ride.organizer.userId.toString() === user._id.toString();

        if (isAlreadyJoined) {
            return res.status(200).json({ success: true, message: 'Zaten bu sürüşe kayıtlısınız.', ride });
        }

        ride.participants.push({
            userId: user._id,
            name: user.name || user.username || 'Motonom Pilotu',
            avatar: user.avatar || '',
            bike: req.body.bike || '',
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

        return res.status(200).json({ 
            success: true, 
            message: 'Sürüşe başarıyla katıldınız!', 
            participantsCount: ride.participants.length + 1 
        });
    } catch (error) {
        console.error('[joinGroupRide Error]:', error);
        return res.status(500).json({ success: false, error: 'Sürüşe katılınamadı.' });
    }
};

export const leaveGroupRide = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id.toString();

        const ride = await GroupRide.findById(id);
        if (!ride) {
            return res.status(404).json({ success: false, error: 'Sürüş bulunamadı.' });
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

                return res.status(200).json({
                    success: true,
                    message: `Organizatörlük ${nextOrganizer.name || 'ilk katılımcıya'} devredildi; sürüşten ayrıldınız.`,
                    participantsCount: ride.participants.length + 1,
                    organizerTransferred: true
                });
            }

            ride.status = 'cancelled';
            await ride.save();
            return res.status(200).json({
                success: true,
                message: 'Katılımcı olmadığı için sürüş iptal edildi.',
                participantsCount: 0,
                rideCancelled: true
            });
        }

        const updatedRide = await GroupRide.findOneAndUpdate(
            { _id: id, 'participants.userId': req.user._id },
            { $pull: { participants: { userId: req.user._id } } },
            { new: true }
        ).select('_id participants');

        if (!updatedRide) {
            return res.status(409).json({
                success: false,
                error: 'Bu sürüşte aktif bir katılım kaydınız bulunamadı.'
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Sürüş katılımı iptal edildi.', 
            participantsCount: updatedRide.participants.length + 1
        });
    } catch (error) {
        console.error('[leaveGroupRide Error]:', error);
        return res.status(500).json({ success: false, error: 'Sürüşten ayrılınamadı.' });
    }
};

export const toggleGroupLiveRadar = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id.toString();

        const ride = await GroupRide.findById(id);
        if (!ride) {
            return res.status(404).json({ success: false, error: 'Sürüş bulunamadı.' });
        }

        // Yalnızca organizatör başlatabilir
        if (ride.organizer.userId.toString() !== userId) {
            return res.status(403).json({ success: false, error: 'Canlı radar oturumunu sadece sürüş lideri yönetebilir.' });
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
        return res.status(200).json({ success: true, liveRadar: ride.liveRadar, status: ride.status });
    } catch (error) {
        console.error('[toggleGroupLiveRadar Error]:', error);
        return res.status(500).json({ success: false, error: 'Canlı radar durumu değiştirilemedi.' });
    }
};
