import { ensureDefaultAchievements } from './services/achievementEngine.js';
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import admin from 'firebase-admin';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Credentials are provided by the host's Application Default Credentials.
// GOOGLE_APPLICATION_CREDENTIALS may point to an external secret-manager mount.
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        ...(process.env.FIREBASE_STORAGE_BUCKET
            ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET } : {})
    });
}

import uploadRoutes from './routes/uploadRoutes.js';
// import authRoutes from './routes/authRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import routeRoutes from './routes/routeRoutes.js';
import geoRoutes from './routes/geoRoutes.js';
import slideRoutes from './routes/slideRoutes.js';
import storyRoutes from './routes/storyRoutes.js';
import vlogRoutes from './routes/vlogRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import forumRoutes from './routes/forumRoutes.js';
import musicRoutes from './routes/musicRoutes.js';
import modelRoutes from './routes/modelRoutes.js';
import stolenRoutes from './routes/stolenRoutes.js';
import negotiationRoutes from './routes/negotiationRoutes.js';
import feedbackRoutes from './routes/feedbackRoutes.js';
import showcaseRoutes from './routes/showcaseRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import userRoutes from './routes/userRoutes.js';
import authRoutes from './routes/authRoutes.js';
import businessReviewRoutes from './routes/businessReviewRoutes.js';
import businessAnalyticsRoutes from './routes/businessAnalyticsRoutes.js';
import businessCommerceRoutes from './routes/businessCommerceRoutes.js';
import reelRoutes from './routes/reelRoutes.js';
import postRoutes from './routes/postRoutes.js';
import rideRoutes from './routes/rideRoutes.js'; // Enabled
import uiRoutes from './routes/uiRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import aiRoutes from './routes/aiRoutes.js';

import http from 'http';
import { initSync } from './socket.js';
import reportRoutes from './routes/reportRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import spotifyRoutes from './routes/spotifyRoutes.js';
import lastfmRoutes from './routes/lastfmRoutes.js';
import emojiRoutes from './routes/emojiRoutes.js';
import beaconRoutes from './routes/beaconRoutes.js';
import packRoutes from './routes/packRoutes.js';
import adRoutes from './routes/adRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import exploreRoutes from './routes/exploreRoutes.js';
import leaderboardRoutes from './routes/leaderboardRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import revenuecatWebhookRoute from './routes/revenuecatWebhookRoute.js';
import tagRoutes from './routes/tagRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import councilRoutes from './routes/councilRoutes.js';
import homeRoutes from './routes/homeRoutes.js';
import { initLeaderboardCron } from './services/leaderboardService.js';
import { initBusinessFlashExpiryCron } from './services/businessFlashExpiryService.js';
import { getAllowedOrigins, getBodyLimit, getMongoUri, validateRuntimeEnv } from './config/env.js';
import { attachRequestId, createCorsOptions, rejectUnsafeMongoKeys, setSecurityHeaders } from './middleware/securityMiddleware.js';
import { apiNotFound, globalErrorHandler } from './middleware/errorMiddleware.js';
import { getRuntimeCapabilities, disabledReleaseFeature } from './config/release.js';

// Import Models to ensure registration
import './models/User.js';
import './models/Post.js'; // Registers 'SocialPost'
import './models/Order.js';
import './models/Analytics.js';
import './models/Ride.js'; // Enabled
import Route from './models/Route.js'; // Imported for seeding
import MeetupEvent from './models/MeetupEvent.js';
import Emoji from './models/Emoji.js';
import './models/Beacon.js'; // Initialize beacon schema indexing
import './models/Campaign.js'; // Campaign & UserChallenge registration
import './models/UserChallenge.js';
import './models/Appointment.js';

validateRuntimeEnv();

const app = express();
const server = http.createServer(app); // Create HTTP server
const io = initSync(server); // Initialize Socket.io

const PORT = process.env.PORT || 5001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Multer (Memory Storage)
const upload = multer({ storage: multer.memoryStorage() });



app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(attachRequestId);
app.use(setSecurityHeaders);
app.use(compression());
app.use(cors(createCorsOptions(getAllowedOrigins())));
app.use(express.json({
    limit: getBodyLimit(),
    verify: (req, res, buffer) => {
        if (req.originalUrl.startsWith('/api/webhooks/revenuecat')) {
            req.rawBody = Buffer.from(buffer);
        }
    },
}));
app.use(express.urlencoded({ limit: getBodyLimit(), extended: true }));
app.use(rejectUnsafeMongoKeys);

// Uploads klasörünü dışarıya aç (Range request desteği ile)
app.use('/api/uploads', (req, res, next) => {
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
}, express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, path) => {
        res.setHeader('Accept-Ranges', 'bytes');
    },
    fallthrough: true
}), (req, res) => {
    // Fallback: file not found but still send CORS headers
    res.status(404).json({ status: 'error', message: 'Dosya bulunamadı.' });
});

// Middleware
// 1. Logger & Firebase URL Fixer
app.use((req, res, next) => {
    // Firebase Functions 'api' isimli fonksiyon üzerinden çağrıldığında
    // URL'in başındaki '/api' kısmını kırpar. Bizim rotalarımız '/api'
    // beklediği için, eksikse geri ekliyoruz.
    if (!req.url.startsWith('/api') && req.url !== '/') {
        req.url = '/api' + req.url;
        req.originalUrl = req.url;
    }
    // Disabled by default; never include query strings, IDs or request bodies.
    if (process.env.HTTP_REQUEST_LOGGING === 'true') {
        const startedAt = performance.now();
        res.on('finish', () => console.info(JSON.stringify({
            level: 'info', event: 'http_request', requestId: req.id,
            method: req.method, route: req.route?.path || 'unmatched',
            status: res.statusCode, durationMs: Math.round(performance.now() - startedAt)
        })));
    }
    next();
});




const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { status: 'error', message: 'Cok fazla kimlik dogrulama istegi. Lutfen daha sonra tekrar deneyin.' }
});

const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 300, // Limit each IP to 300 requests per windowMs
    standardHeaders: 'draft-8',
    legacyHeaders: false,
});

app.use(globalLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);

// --- MONGODB MODELS ---

// User Model moved to backend/models/User.js
// SocialPost Model moved to backend/models/Post.js

import Product from './models/Product.js';

// Order model moved to backend/models/Order.js

// Slide Model moved to backend/models/Slide.js
import Slide from './models/Slide.js';

// Story Model moved to backend/models/Story.js
import './models/Story.js';

import Visitor from './models/Visitor.js';

import Category from './models/Category.js';

// Route Model moved to backend/models/Route.js
import './models/Route.js';
import Reel from './models/Reel.js';

import ForumTopic from './models/ForumTopic.js';

import Music from './models/Music.js';

import Negotiation from './models/Negotiation.js';

import StolenItem from './models/StolenItem.js';

import MotoVlog from './models/MotoVlog.js';

import ServicePoint from './models/ServicePoint.js';

import Model3D from './models/Model3D.js';

import Feedback from './models/Feedback.js';



import ShowcaseProduct from './models/ShowcaseProduct.js';


// --- DATA SEEDING ---
const seedDatabase = async () => {
    try {
        const catCount = await Category.countDocuments();
        if (catCount === 0) {
            console.log('📦 Kategoriler veritabanına ekleniyor...');
            await Category.insertMany([
                { name: 'KASKLAR', type: 'Kask', image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=800&auto=format&fit=crop', desc: 'Maksimum Güvenlik', count: '142 Model', className: 'col-span-2 row-span-2' },
                { name: 'MONTLAR', type: 'Mont', image: 'https://images.unsplash.com/photo-1559582930-bb01987cf4dd?q=80&w=800&auto=format&fit=crop', desc: '4 Mevsim Koruma', count: '85 Model', className: 'col-span-2 row-span-1' },
                { name: 'ELDİVENLER', type: 'Eldiven', image: 'https://images.unsplash.com/photo-1555481771-16417c6f656c?q=80&w=800&auto=format&fit=crop', desc: 'Hassas Kontrol', count: '64 Model', className: 'col-span-1 row-span-1' },
                { name: 'BOTLAR', type: 'Bot', image: 'https://images.unsplash.com/photo-1555813456-96e25216239e?q=80&w=800&auto=format&fit=crop', desc: 'Sağlam Adımlar', count: '32 Model', className: 'col-span-1 row-span-1' },
                { name: 'EKİPMAN', type: 'Koruma', image: 'https://images.unsplash.com/photo-1584556966052-c229e215e03f?q=80&w=800&auto=format&fit=crop', desc: 'Zırh & Koruma', count: '95 Parça', className: 'col-span-1 md:col-span-2 row-span-1' },
                { name: 'İNTERKOM', type: 'İnterkom', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=800&auto=format&fit=crop', desc: 'İletişim', count: '12 Model', className: 'col-span-1 md:col-span-2 row-span-1' }
            ]);
        }

        const slideCount = await Slide.countDocuments();
        if (slideCount === 0) {
            console.log('📦 Slider görselleri veritabanına ekleniyor...');
            await Slide.insertMany([
                { id: 1, type: 'video', videoUrl: 'https://videos.pexels.com/video-files/5927870/5927870-uhd_2560_1440_30fps.mp4', image: "https://images.unsplash.com/photo-1609630875171-b1321377ee65?q=80&w=1920&auto=format&fit=crop", title: "RIDE THE FUTURE", subtitle: "YAPAY ZEKA DESTEKLİ EKİPMAN SEÇİMİ İLE TANIŞIN.", cta: "ALIŞVERİŞE BAŞLA", action: 'shop' },
                { id: 2, type: 'image', image: "https://images.unsplash.com/photo-1558981408-db0ecd8a1ee4?q=80&w=1920&auto=format&fit=crop", title: "CARBON & SPEED", subtitle: "PROFESYONELLER İÇİN GELİŞTİRİLMİŞ KASK KOLEKSİYONU.", cta: "KASKLARI GÖR", action: 'shop' },
                { id: 3, type: 'image', image: "https://images.unsplash.com/photo-1547053265-a0c602077e65?q=80&w=1920&auto=format&fit=crop", title: "OFFROAD SPIRIT", subtitle: "SINIRLARI ZORLAYAN MACERALAR İÇİN HAZIR OL.", cta: "KEŞFET", action: 'shop' }
            ]);
        }

        const routeCount = await Route.countDocuments();
        if (routeCount === 0) {
            console.log('📦 Rotalar veritabanına ekleniyor...');
            await Route.insertMany([
                {
                    title: 'Trans Toros Geçişi',
                    description: 'Akdeniz\'in zirvelerinde virajlı ve manzaralı bir sürüş.',
                    image: `uploads/vibemesh_ultra.png`, // Use local image for offline support
                    difficulty: 'Zor',
                    distance: '320 km',
                    estimatedTime: '6 Saat',
                    location: 'Antalya',
                    bestSeason: 'İlkbahar',
                    tags: ['Dağ', 'Viraj'],
                    path: {
                        type: 'LineString',
                        coordinates: [
                            [30.7056, 36.8841], // lng, lat
                            [30.8000, 37.0000],
                            [31.0000, 37.1500],
                            [31.2000, 37.3000],
                            [31.4000, 37.5000]
                        ]
                    },
                    coordinates: [
                        { lat: 36.8841, lng: 30.7056 },
                        { lat: 37.0000, lng: 30.8000 },
                        { lat: 37.1500, lng: 31.0000 },
                        { lat: 37.3000, lng: 31.2000 },
                        { lat: 37.5000, lng: 31.4000 }
                    ]
                }
            ]);
        }

        // FIX: Rotalar yerel resimlere ayarlandı.
        // Gerekli değilse artık her seferinde loop yapıp tüm sunucuyu bekletmiyoruz.


        const prodCount = await Product.countDocuments();
        if (prodCount === 0) {
            console.log('📦 Ürünler veritabanına ekleniyor...');
            await Product.insertMany([
                { name: "AeroSpeed Carbon Pro Kask", description: "Yüksek hız aerodinamiği için tasarlanmış ultra hafif karbon fiber kask. Maksimum görüş açısı ve gelişmiş havalandırma sistemi.", price: 8500, category: "Kask", image: `uploads/carbon_helmet.png`, images: [`uploads/carbon_helmet.png`], rating: 4.8, features: ["Karbon Fiber", "Pinlock"], stock: 15, isNegotiable: true },
                { name: "Urban Rider Deri Mont", description: "Şehir içi sürüşler için şık ve korumalı deri mont. D3O korumalar ile maksimum güvenlik, vintage görünüm.", price: 5200, category: "Mont", image: `uploads/leather_jacket.png`, images: [`uploads/leather_jacket.png`], rating: 4.6, features: ["%100 Deri", "D3O"], stock: 8, isNegotiable: true },
                { name: "ProVision İnterkom", description: "Grup sürüşleri için kristal netliğinde ses sağlayan, uzun menzilli Bluetooth interkom.", price: 2900, category: "İnterkom", image: `uploads/intercom_device.png`, images: [`uploads/intercom_device.png`], rating: 4.7, features: ["1.2km Menzil", "Su Geçirmez"], stock: 30, isNegotiable: false }
            ]);
        }

        // Ensure new 2026 Collection Product exists or update it (skipped for speed if prodCount > 0)
        // --- NEW INTERCOMS (Base64 Upsert) removed from every boot cycle to increase boot speed ---


        const forumCount = await ForumTopic.countDocuments();
        if (forumCount === 0) {
            console.log('📦 Forum konuları veritabanına ekleniyor...');
            await ForumTopic.insertMany([
                {
                    // Remove 'id' field, rely on _id default
                    authorId: 'admin-001',
                    authorName: 'MotoVibe Admin',
                    title: 'MotoVibe Topluluğuna Hoş Geldiniz!',
                    content: 'Merhaba arkadaşlar, burası motosiklet tutkunlarının buluşma noktası. Deneyimlerinizi paylaşabilir, teknik sorular sorabilir veya gezi planlarınızı duyurabilirsiniz. Saygı çerçevesinde keyifli forumlar!',
                    category: 'Genel',
                    date: new Date().toLocaleDateString('tr-TR'),
                    likes: 42,
                    views: 1250,
                    comments: [],
                    tags: ['Duyuru', 'Kurallar']
                }
            ]);
        }

        // Social seeding removed

        const showcaseCount = await ShowcaseProduct.countDocuments();
        if (showcaseCount === 0) {
            console.log('📦 Vitrin ürünleri veritabanına ekleniyor...');
            await ShowcaseProduct.insertMany([
                {
                    name: 'CARBON X-1',
                    description: 'Saf karbon fiber yapı ile aerodinamik mükemmellik. Pistler için tasarlandı, sokaklar için geliştirildi.',
                    price: 12500,
                    category: 'Kask',
                    image: 'https://images.unsplash.com/photo-1599819811279-d5ad9cccf838?auto=format&fit=crop&q=80&w=800',
                    images: [],
                    rating: 5,
                    features: ['Ultra Hafif Karbon Kabuk', 'Acil Durum Çıkarma Sistemi', 'MaxVision Pinlock', 'Rüzgar Tüneli Testli'],
                    stock: 3
                },
                {
                    name: 'VENOM 400',
                    description: 'Taktiksel üstünlükle benzersiz koruma. Venom 400 mont, askeri sınıf malzemeleri günlük sürüşünüze getiriyor.',
                    price: 8900,
                    category: 'Mont',
                    image: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&q=80&w=800',
                    images: [],
                    rating: 4.8,
                    features: ['Cordura® Yapı', 'CE Seviye 2 Koruma', 'Su Geçirmez Membran', 'Sıvı Takviyesi Hazır'],
                    stock: 12
                },
                {
                    name: 'TITAN BOOTS',
                    description: 'Yerçekimi kadar sağlam bir denge. Titan botları, ekstrem koşullar için nihai tutuş ve bilek desteği sağlar.',
                    price: 6750,
                    category: 'Bot',
                    image: 'https://images.unsplash.com/photo-1609630875171-b132137746be?auto=format&fit=crop&q=80&w=800',
                    images: [],
                    rating: 4.9,
                    features: ['Gore-Tex Ekstrem', 'Vibram Taban', 'Kompozit Burun', 'Ayarlanabilir Toka Sistemi'],
                    stock: 8
                }
            ]);
        }

        const eventCount = await MeetupEvent.countDocuments();
        if (eventCount === 0) {
            console.log('📦 Etkinlikler veritabanına ekleniyor...');
            await MeetupEvent.insertMany([
                {
                    title: 'Gece Sürüşü: İstanbul Işıkları',
                    type: 'night-ride',
                    date: '2025-06-15',
                    time: '22:00',
                    location: 'Bağdat Caddesi, İstanbul',
                    coordinates: { lat: 40.9632, lng: 29.0632 },
                    organizer: 'MotoVibe Team',
                    attendees: 42,
                    image: 'https://images.unsplash.com/photo-1558981403-c5f91cbba527?q=80&w=800&auto=format&fit=crop',
                    description: 'İstanbul\'un eşsiz gece manzarasında yaklaşık 2 saatlik keyifli bir sürüş.'
                },
                {
                    title: 'Pazar Kahvesi & Sohbet',
                    type: 'coffee',
                    date: '2025-06-18',
                    time: '10:00',
                    location: 'Emirgan Korusu',
                    coordinates: { lat: 41.1082, lng: 29.0553 },
                    organizer: 'Cafe Racers TR',
                    attendees: 15,
                    image: 'https://images.unsplash.com/photo-1512413914633-b5043f4041ea?q=80&w=800&auto=format&fit=crop',
                    description: 'Hafta sonuna güzel bir kahve ve motosiklet sohbetiyle başlıyoruz.'
                }
            ]);
        }



        const emojiCount = await Emoji.countDocuments();
        if (emojiCount < 7) {
            console.log('📦 Yeni Custom Emojiler veritabanına ekleniyor (MotoMojis V2)...');
            const newEmojis = [
                { code: ':moto_wave:', imageUrl: `uploads/moto_wave.png`, category: 'REACTIONS', tags: ['selam', 'wave', 'biker'], isPremium: false, sortOrder: 1 },
                { code: ':moto_fire:', imageUrl: `uploads/moto_fire.png`, category: 'REACTIONS', tags: ['ateş', 'fire', 'lit'], isPremium: false, sortOrder: 2 },
                { code: ':moto_heart:', imageUrl: `uploads/moto_heart.png`, category: 'REACTIONS', tags: ['kalp', 'heart', 'love', 'piston'], isPremium: false, sortOrder: 3 },
                { code: ':neon_helmet:', imageUrl: `uploads/neon_helmet.png`, category: 'GEAR', tags: ['kask', 'helmet', 'neon'], isPremium: false, sortOrder: 1 },
                { code: ':moto_wheel:', imageUrl: `uploads/moto_wheel.png`, category: 'GEAR', tags: ['teker', 'wheel', 'rim', 'tire'], isPremium: false, sortOrder: 2 },
                { code: ':speedometer:', imageUrl: `uploads/speedometer.png`, category: 'TECH', tags: ['hız', 'speed', 'tacho'], isPremium: false, sortOrder: 1 },
                { code: ':moto_key:', imageUrl: `uploads/moto_key.png`, category: 'TECH', tags: ['anahtar', 'key', 'fob'], isPremium: false, sortOrder: 2 },
            ];

            for (let emoji of newEmojis) {
                await Emoji.findOneAndUpdate(
                    { code: emoji.code },
                    { $set: emoji },
                    { upsert: true, returnDocument: 'after' }
                );
            }
        }

        if (process.env.SEED_ADMIN === 'true') {
            const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
            const adminUsername = process.env.ADMIN_USERNAME?.trim();
            const adminPassword = process.env.ADMIN_PASSWORD;
            if (!adminEmail || !adminUsername || !adminPassword || adminPassword.length < 12) {
                throw new Error('Admin bootstrap icin ADMIN_EMAIL, ADMIN_USERNAME ve en az 12 karakterli ADMIN_PASSWORD zorunludur.');
            }

            const User = mongoose.model('User');
            const hashedAdminPassword = await bcrypt.hash(adminPassword, 12);
            await User.findOneAndUpdate(
                { email: adminEmail },
                {
                    $setOnInsert: {
                        name: 'MotoVibe Admin',
                        username: adminUsername,
                        password: hashedAdminPassword,
                        isAdmin: true,
                        joinDate: new Date().toLocaleDateString('tr-TR'),
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            console.log('✅ Admin hesabi bootstrap edildi. SEED_ADMIN degerini false yapin.');
        }

    } catch (error) {
        console.error('Veri tohumlama hatası:', error);
    }
};

// --- ROUTES ---

// 0. Upload Route
// This release exposes the core product only, including for direct API clients.
for (const prefix of ['/products', '/orders', '/showcase', '/negotiations', '/music',
    '/spotify', '/lastfm', '/forum', '/vlogs', '/council', '/stolen-items', '/ai']) {
    app.use(`/api${prefix}`, disabledReleaseFeature);
}
app.get('/api/capabilities', async (req, res, next) => {
    try {
        const capabilities = getRuntimeCapabilities();
        if (req.query.businessId !== undefined) {
            const id = req.query.businessId;
            if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) {
                return res.status(400).json({ status: 'error', message: 'Geçersiz işletme.' });
            }
            const business = capabilities.businessCheckout
                ? await mongoose.model('User').findById(id)
                    .select('userType +businessProfile.iyzicoSubMerchantKey').lean()
                : null;
            capabilities.businessCheckout = Boolean(business?.userType === 'PROFESSIONAL' &&
                business.businessProfile?.iyzicoSubMerchantKey?.trim());
        }
        res.set('Cache-Control', 'no-store');
        res.json({ status: 'success', data: capabilities });
    } catch (error) { next(error); }
});

app.use('/api/upload', uploadRoutes);


app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api', geoRoutes);
app.use('/api/slides', slideRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/vlogs', vlogRoutes);

app.use('/api/events', eventRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/users', userRoutes);
app.use('/api/business-reviews', businessReviewRoutes);
app.use('/api/business-analytics', businessAnalyticsRoutes);
app.use('/api/business-commerce', businessCommerceRoutes);
app.use('/api/posts', postRoutes); // Using postRoutes as requested
app.use('/api/social', postRoutes); // Map legacy route to new logic
app.use('/api/reels', reelRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/showcase', showcaseRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/stolen-items', stolenRoutes);
app.use('/api/negotiations', negotiationRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/ui-settings', uiRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/lastfm', lastfmRoutes);
app.use('/api/emojis', emojiRoutes);
app.use('/api/beacons', beaconRoutes);
app.use('/api/packs', packRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/explore', exploreRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/sponsorship/campaigns', campaignRoutes);
app.use('/api/sponsorship', campaignRoutes);
app.use('/api/webhooks/revenuecat', revenuecatWebhookRoute);
app.use('/api/tags', tagRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/council', councilRoutes);
app.use('/api/home', homeRoutes);

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        data: {
            service: 'motovibe-api',
            uptimeSeconds: Math.floor(process.uptime()),
        },
    });
});

app.use('/api', apiNotFound);
app.use(globalErrorHandler);

// --- FRONTEND STATIK DOSYALARINI SERVIS ET (PROD) ---
// Firebase ortamında bu özelliği devre dışı bırakıyoruz (sadece API çalışsın)
const isFirebase = process.env.FIREBASE_CONFIG !== undefined || process.env.FUNCTIONS_EMULATOR === 'true';

const frontendPath = path.join(__dirname, '../dist');
const hasFrontendDist = fs.existsSync(path.resolve(frontendPath, 'index.html'));

if (!isFirebase && hasFrontendDist && (process.env.NODE_ENV === 'production' || process.env.SERVE_FRONTEND === 'true')) {
    app.use(express.static(frontendPath));

    app.get(/(.*)/, (req, res) => {
        if (req.path.startsWith('/api')) { // API isteklerini engelleme
            return res.status(404).json({ message: 'API route found but method not handled or path wrong' });
        }
        res.sendFile(path.resolve(frontendPath, 'index.html'));
    });
} else {
    // Bilgilendirme ve Healthcheck
    app.get('/', (req, res) => {
        res.send('🚀 MotoVibe Backend API Çalışıyor!');
    });
}

// --- DATABASE BAĞLANTISI ---
mongoose.connect(getMongoUri())
    .then(() => {
        console.log('✅ MongoDB bağlantısı başarılı');
        initLeaderboardCron();
        initBusinessFlashExpiryCron();
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server çalışıyor: ${BASE_URL}`);
            console.log('📡 Tüm ağ arayüzleri dinleniyor (Physical device ready)');
            console.log('📂 Uploads: Local & Static enabled');
        });
        // Seeding is best-effort development data. It must never delay API
        // availability or block route intelligence and mobile clients at boot.
        if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_DATA === 'true') {
            void seedDatabase();
        }
        void ensureDefaultAchievements();
    })
    .catch(err => {
        console.error('❌ MongoDB bağlantı hatası:', err.message);
        process.exit(1);
    });

const shutdown = async (signal) => {
    console.log(`${signal} alindi, sunucu kapatiliyor.`);
    server.close(async () => {
        await mongoose.connection.close();
        process.exit(0);
    });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

export default app;
