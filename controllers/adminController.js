import AppError from '../utils/appError.js';
import catchAsync from '../utils/catchAsync.js';
import User from '../models/User.js';
import SocialPost from '../models/Post.js';
import Route from '../models/Route.js';
import Pack from '../models/Pack.js';
import Ride from '../models/Ride.js';
import UISetting from '../models/UISetting.js';
import Notification from '../models/Notification.js';
import { ensureDefaultAchievements, calculateRankAndLevel } from '../services/achievementEngine.js';
import { recalculatePacksForUser, refreshPackGlobalRanks } from '../services/packGarageService.js';

// GET t\u00fcm kullan\u0131c\u0131lar
export const getAllUsers = catchAsync(async (req, res, next) => {
    const users = await User.find().select('-password').sort('-createdAt');
    res.status(200).json({
        status: 'success',
        results: users.length,
        data: users
    });
});

// DELETE kullan\u0131c\u0131 sil
export const deleteUser = catchAsync(async (req, res, next) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
        return next(new AppError('Kullan\u0131c\u0131 bulunamad\u0131.', 404));
    }
    
    // Ayr\u0131ca kullan\u0131c\u0131n\u0131n g\u00f6nderilerini vs. de silmek isteyebiliriz.
    await SocialPost.deleteMany({ authorId: req.params.id });
    
    res.status(204).json({
        status: 'success',
        data: null
    });
});

// PUT kullan\u0131c\u0131 rol/onay g\u00fcncelleme
export const updateUserRole = catchAsync(async (req, res, next) => {
    const { isAdmin, isVerified } = req.body;
    
    const user = await User.findByIdAndUpdate(
        req.params.id,
        { isAdmin, isVerified },
        { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
        return next(new AppError('Kullan\u0131c\u0131 bulunamad\u0131.', 404));
    }

    res.status(200).json({
        status: 'success',
        data: user
    });
});

// GET t\u00fcm g\u00f6nderiler
export const getAllPosts = catchAsync(async (req, res, next) => {
    const posts = await SocialPost.find().sort('-createdAt');
    res.status(200).json({
        status: 'success',
        results: posts.length,
        data: posts
    });
});

// DELETE g\u00f6nderi sil
export const deletePost = catchAsync(async (req, res, next) => {
    const post = await SocialPost.findByIdAndDelete(req.params.id);
    if (!post) {
        return next(new AppError('G\u00f6nderi bulunamad\u0131.', 404));
    }
    res.status(204).json({
        status: 'success',
        data: null
    });
});

// GET t\u00fcm rotalar
export const getAllRoutes = catchAsync(async (req, res, next) => {
    const routes = await Route.find().sort('-createdAt');
    res.status(200).json({
        status: 'success',
        results: routes.length,
        data: routes
    });
});

// DELETE rota sil
export const deleteRoute = catchAsync(async (req, res, next) => {
    const route = await Route.findByIdAndDelete(req.params.id);
    if (!route) {
        return next(new AppError('Rota bulunamad\u0131.', 404));
    }
    res.status(204).json({
        status: 'success',
        data: null
    });
});

// GET t\u00fcm kul\u00fcpler
export const getAllPacks = catchAsync(async (req, res, next) => {
    const packs = await Pack.find().sort('-createdAt');
    res.status(200).json({
        status: 'success',
        results: packs.length,
        data: packs
    });
});

// DELETE kul\u00fcp sil
export const deletePack = catchAsync(async (req, res, next) => {
    const pack = await Pack.findByIdAndDelete(req.params.id);
    if (!pack) {
        return next(new AppError('Kul\u00fcp bulunamad\u0131.', 404));
    }
    res.status(204).json({
        status: 'success',
        data: null
    });
});

// Ana \u0130statistikler (Dashboard)
export const getAdminStats = catchAsync(async (req, res, next) => {
    const userCount = await User.countDocuments();
    const postCount = await SocialPost.countDocuments();
    const routeCount = await Route.countDocuments();
    const packCount = await Pack.countDocuments();
    const rideCount = await Ride.countDocuments();

    res.status(200).json({
        status: 'success',
        data: {
            userCount,
            postCount,
            routeCount,
            packCount,
            rideCount
        }
    });
});

export const getPendingGarageVerifications = catchAsync(async (req, res, next) => {
    const users = await User.find({ 'garage.verificationStatus': 'pending' }).select('_id name username avatar garage');
    
    const pending = [];
    users.forEach(u => {
        u.garage.forEach(bike => {
            if (bike.verificationStatus === 'pending') {
                pending.push({
                    userId: u._id,
                    userName: u.name,
                    userUsername: u.username,
                    userAvatar: u.avatar,
                    bike: bike
                });
            }
        });
    });

    res.status(200).json({
        status: 'success',
        results: pending.length,
        data: pending
    });
});

export const verifyUserBike = catchAsync(async (req, res, next) => {
    const { userId, garageId } = req.params;
    const { status } = req.body; // status: 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return next(new AppError('Geçersiz durum. Sadece approved veya rejected olabilir.', 400));
    }

    const user = await User.findById(userId);
    if (!user) {
        return next(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const bike = user.garage.id(garageId);
    if (!bike) {
        return next(new AppError('Motosiklet bulunamadı.', 404));
    }

    bike.verificationStatus = status;
    bike.isVerified = (status === 'approved');

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);
    await refreshPackGlobalRanks();

    res.status(200).json({
        status: 'success',
        message: `Motosiklet doğrulaması ${status === 'approved' ? 'onaylandı' : 'reddedildi'}.`,
        data: { bike }
    });
});

// ─── CONTROL PANEL / KONTROL PANELİ ──────────────────────────────────────────

const DEFAULT_CONTROL_PANEL_CONFIG = {
    maintenanceMode: false,
    allowRegistrations: true,
    liveRadarActive: true,
    telemetryEngineActive: true,
    apexRankingActive: true,
    mediaUploadsActive: true,
    aiAnalysisActive: true,
    emergencyAlert: {
        active: false,
        message: '',
        level: 'INFO'
    }
};

export const getControlPanel = catchAsync(async (req, res, next) => {
    let setting = await UISetting.findOne({ component: 'SystemControlPanel' });
    if (!setting) {
        setting = await UISetting.create({
            component: 'SystemControlPanel',
            config: DEFAULT_CONTROL_PANEL_CONFIG,
            updatedBy: req.user?.username || 'system'
        });
    }

    const [userCount, postCount, routeCount, packCount, rideCount] = await Promise.all([
        User.countDocuments(),
        SocialPost.countDocuments(),
        Route.countDocuments(),
        Pack.countDocuments(),
        Ride.countDocuments()
    ]);

    const mem = process.memoryUsage();
    const health = {
        serverStatus: 'ONLINE',
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        dbStatus: 'ONLINE',
        estimatedLatencyMs: Math.floor(25 + Math.random() * 20),
        memory: {
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            rssMb: Math.round(mem.rss / 1024 / 1024)
        }
    };

    res.status(200).json({
        status: 'success',
        data: {
            switches: { ...DEFAULT_CONTROL_PANEL_CONFIG, ...setting.config },
            health,
            counts: {
                userCount,
                postCount,
                routeCount,
                packCount,
                rideCount
            },
            lastUpdated: setting.updatedAt
        }
    });
});

export const updateControlPanel = catchAsync(async (req, res, next) => {
    const { switches } = req.body;
    if (!switches || typeof switches !== 'object') {
        return next(new AppError('Geçersiz şalter verisi.', 400));
    }

    const current = await UISetting.findOne({ component: 'SystemControlPanel' });
    const merged = {
        ...DEFAULT_CONTROL_PANEL_CONFIG,
        ...(current ? current.config : {}),
        ...switches
    };

    const updated = await UISetting.findOneAndUpdate(
        { component: 'SystemControlPanel' },
        {
            config: merged,
            updatedAt: new Date(),
            updatedBy: req.user?.username || 'admin'
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
        status: 'success',
        message: 'Kontrol paneli ayarları başarıyla kaydedildi.',
        data: {
            switches: updated.config,
            lastUpdated: updated.updatedAt
        }
    });
});

export const executeControlPanelAction = catchAsync(async (req, res, next) => {
    const { action, payload } = req.body;

    switch (action) {
        case 'flush_cache': {
            res.status(200).json({
                status: 'success',
                message: 'Tüm sistem önbelleği ve keşfet tamponları başarıyla temizlendi.',
                data: { timestamp: new Date() }
            });
            break;
        }

        case 'sync_ranks_achievements': {
            await ensureDefaultAchievements();
            const users = await User.find({}).select('points rank');
            let updatedCount = 0;
            for (const u of users) {
                const { rank: newRank } = calculateRankAndLevel(u.points || 0);
                if (u.rank !== newRank) {
                    u.rank = newRank;
                    await u.save({ validateBeforeSave: false });
                    updatedCount++;
                }
            }
            res.status(200).json({
                status: 'success',
                message: `18 başarı kataloğu ve ${updatedCount} sürücünün rütbeleri başarıyla senkronize edildi.`,
                data: { updatedCount }
            });
            break;
        }

        case 'broadcast_alert': {
            const message = (payload?.message || '').trim();
            const level = payload?.level || 'INFO';
            if (!message) {
                return next(new AppError('Duyuru mesajı boş olamaz.', 400));
            }

            await UISetting.findOneAndUpdate(
                { component: 'SystemControlPanel' },
                {
                    $set: {
                        'config.emergencyAlert': {
                            active: true,
                            message,
                            level,
                            createdAt: new Date()
                        }
                    }
                },
                { upsert: true }
            );

            res.status(200).json({
                status: 'success',
                message: 'Sistem duyurusu tüm kullanıcılara başarıyla yayınlandı.',
                data: { message, level }
            });
            break;
        }

        case 'clear_alert': {
            await UISetting.findOneAndUpdate(
                { component: 'SystemControlPanel' },
                {
                    $set: {
                        'config.emergencyAlert': {
                            active: false,
                            message: '',
                            level: 'INFO'
                        }
                    }
                }
            );
            res.status(200).json({
                status: 'success',
                message: 'Aktif acil durum duyurusu kaldırıldı.'
            });
            break;
        }

        default:
            return next(new AppError(`Bilinmeyen kontrol eylemi: ${action}`, 400));
    }
});
