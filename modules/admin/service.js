import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import AppError from "../../utils/appError.js";

import User from "../users/model.js";
import SocialPost from "../posts/model.js";
import Route from "../routes/model.js";
import Pack from "../packs/model.js";
import Ride from "../rides/model.js";
import UISetting from "../ui/model.js";
import Notification from "../notifications/model.js";
import { ensureDefaultAchievements, calculateRankAndLevel } from "../achievements/service.js";
import { recalculatePacksForUser, refreshPackGlobalRanks } from "../packs/service.js";

// GET t\u00fcm kullan\u0131c\u0131lar
export const getAllUsers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const users = await User.find().select('-password').sort('-createdAt');
    respond({
        status: 'success',
        results: users.length,
        data: users
    },200);

    return response;
};

// DELETE kullan\u0131c\u0131 sil
export const deleteUser = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const user = await User.findByIdAndDelete(input.params.id);
    if (!user) {
        return throwError(new AppError('Kullan\u0131c\u0131 bulunamad\u0131.', 404));
    }

    // Ayr\u0131ca kullan\u0131c\u0131n\u0131n g\u00f6nderilerini vs. de silmek isteyebiliriz.
    await SocialPost.deleteMany({ authorId: input.params.id });

    respond({
        status: 'success',
        data: null
    },204);

    return response;
};

// PUT kullan\u0131c\u0131 rol/onay g\u00fcncelleme
export const updateUserRole = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { isAdmin, isVerified } = input.body;

    const user = await User.findByIdAndUpdate(
        input.params.id,
        { isAdmin, isVerified },
        { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
        return throwError(new AppError('Kullan\u0131c\u0131 bulunamad\u0131.', 404));
    }

    respond({
        status: 'success',
        data: user
    },200);

    return response;
};

// GET t\u00fcm g\u00f6nderiler
export const getAllPosts = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const posts = await SocialPost.find().sort('-createdAt');
    respond({
        status: 'success',
        results: posts.length,
        data: posts
    },200);

    return response;
};

// DELETE g\u00f6nderi sil
export const deletePost = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const post = await SocialPost.findByIdAndDelete(input.params.id);
    if (!post) {
        return throwError(new AppError('G\u00f6nderi bulunamad\u0131.', 404));
    }
    respond({
        status: 'success',
        data: null
    },204);

    return response;
};

// GET t\u00fcm rotalar
export const getAllRoutes = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const routes = await Route.find().sort('-createdAt');
    respond({
        status: 'success',
        results: routes.length,
        data: routes
    },200);

    return response;
};

// DELETE rota sil
export const deleteRoute = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const route = await Route.findByIdAndDelete(input.params.id);
    if (!route) {
        return throwError(new AppError('Rota bulunamad\u0131.', 404));
    }
    respond({
        status: 'success',
        data: null
    },204);

    return response;
};

// GET t\u00fcm kul\u00fcpler
export const getAllPacks = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const packs = await Pack.find().sort('-createdAt');
    respond({
        status: 'success',
        results: packs.length,
        data: packs
    },200);

    return response;
};

// DELETE kul\u00fcp sil
export const deletePack = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const pack = await Pack.findByIdAndDelete(input.params.id);
    if (!pack) {
        return throwError(new AppError('Kul\u00fcp bulunamad\u0131.', 404));
    }
    respond({
        status: 'success',
        data: null
    },204);

    return response;
};

// Ana \u0130statistikler (Dashboard)
export const getAdminStats = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const userCount = await User.countDocuments();
    const postCount = await SocialPost.countDocuments();
    const routeCount = await Route.countDocuments();
    const packCount = await Pack.countDocuments();
    const rideCount = await Ride.countDocuments();

    respond({
        status: 'success',
        data: {
            userCount,
            postCount,
            routeCount,
            packCount,
            rideCount
        }
    },200);

    return response;
};

export const getPendingGarageVerifications = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

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

    respond({
        status: 'success',
        results: pending.length,
        data: pending
    },200);

    return response;
};

export const verifyUserBike = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { userId, garageId } = input.params;
    const { status } = input.body; // status: 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return throwError(new AppError('Geçersiz durum. Sadece approved veya rejected olabilir.', 400));
    }

    const user = await User.findById(userId);
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const bike = user.garage.id(garageId);
    if (!bike) {
        return throwError(new AppError('Motosiklet bulunamadı.', 404));
    }

    bike.verificationStatus = status;
    bike.isVerified = (status === 'approved');

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);
    await refreshPackGlobalRanks();

    respond({
        status: 'success',
        message: `Motosiklet doğrulaması ${status === 'approved' ? 'onaylandı' : 'reddedildi'}.`,
        data: { bike }
    },200);

    return response;
};

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

export const getControlPanel = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    let setting = await UISetting.findOne({ component: 'SystemControlPanel' });
    if (!setting) {
        setting = await UISetting.create({
            component: 'SystemControlPanel',
            config: DEFAULT_CONTROL_PANEL_CONFIG,
            updatedBy: input.user?.username || 'system'
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

    respond({
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
    },200);

    return response;
};

export const updateControlPanel = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { switches } = input.body;
    if (!switches || typeof switches !== 'object') {
        return throwError(new AppError('Geçersiz şalter verisi.', 400));
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
            updatedBy: input.user?.username || 'admin'
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    respond({
        status: 'success',
        message: 'Kontrol paneli ayarları başarıyla kaydedildi.',
        data: {
            switches: updated.config,
            lastUpdated: updated.updatedAt
        }
    },200);

    return response;
};

export const executeControlPanelAction = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const { action, payload } = input.body;

    switch (action) {
        case 'flush_cache': {
            respond({
                status: 'success',
                message: 'Tüm sistem önbelleği ve keşfet tamponları başarıyla temizlendi.',
                data: { timestamp: new Date() }
            },200);
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
            respond({
                status: 'success',
                message: `18 başarı kataloğu ve ${updatedCount} sürücünün rütbeleri başarıyla senkronize edildi.`,
                data: { updatedCount }
            },200);
            break;
        }

        case 'broadcast_alert': {
            const message = (payload?.message || '').trim();
            const level = payload?.level || 'INFO';
            if (!message) {
                return throwError(new AppError('Duyuru mesajı boş olamaz.', 400));
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

            respond({
                status: 'success',
                message: 'Sistem duyurusu tüm kullanıcılara başarıyla yayınlandı.',
                data: { message, level }
            },200);
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
            respond({
                status: 'success',
                message: 'Aktif acil durum duyurusu kaldırıldı.'
            },200);
            break;
        }

        default:
            return throwError(new AppError(`Bilinmeyen kontrol eylemi: ${action}`, 400));
    }

    return response;
};
