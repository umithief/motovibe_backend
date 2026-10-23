import swaggerJSDoc from 'swagger-jsdoc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Central OpenAPI 3.0.0 definition for the MotoVibe / Motonom backend.
 *
 * Endpoint documentation lives next to the code as `@openapi` JSDoc blocks in
 * the module route files; this file only declares the shared metadata, the JWT
 * security scheme and the reusable `components` that those blocks `$ref`.
 *
 * NOTE: every route is mounted under the `/api` prefix (see app.js), so the
 * documented paths include that prefix and the `servers` entries are bare hosts.
 */
const definition = {
    openapi: '3.0.0',
    info: {
        title: 'MotoVibe / Motonom API',
        version: '1.0.0',
        description:
            'Motosiklet sosyal platformu MotoVibe (Motonom) için REST API dokümantasyonu.\n\n' +
            '- Tüm uçlar `/api` ön eki altında yayınlanır.\n' +
            '- Korumalı uçlar `Authorization: Bearer <accessToken>` başlığı bekler. ' +
            'Access token `/api/users/login`, `/api/users/register` veya `/api/auth/refresh` ' +
            'uçlarından alınır.\n' +
            '- Varsayılan (v1) yanıtlar servis gövdesini aynen döndürür; `/api/v2/...` ' +
            'çağrıları ise `{ status, data, meta? }` zarfına sarar.',
    },
    servers: [
        { url: 'https://api.motonom.app', description: 'Canlı ortam (production)' },
        { url: 'http://localhost:5001', description: 'Yerel geliştirme ortamı' },
    ],
    tags: [
        { name: 'Auth', description: 'Oturum yönetimi, şifre sıfırlama ve token yenileme' },
        { name: 'Users', description: 'Kullanıcı kaydı, profil, sosyal grafik, garaj ve işletme profili' },
        { name: 'Ads', description: 'Sponsorlu reklamlar, reklam paketleri ve metrikler' },
        { name: 'Tags', description: 'Etiketler (hashtag) — trend, arama, takip' },
        { name: 'System', description: 'Sağlık kontrolü ve çalışma zamanı yetenekleri' },
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'JWT access token. Örnek: `Authorization: Bearer eyJhbGciOi...`',
            },
        },
        schemas: {
            ErrorResponse: {
                type: 'object',
                description: 'Standart hata gövdesi (globalErrorHandler tarafından üretilir).',
                properties: {
                    status: { type: 'string', example: 'error' },
                    message: { type: 'string', example: 'İstek işlenemedi.' },
                    data: { type: 'object', nullable: true, example: null },
                    error: {
                        type: 'object',
                        properties: {
                            message: { type: 'string', example: 'İstek işlenemedi.' },
                            code: { type: 'string', example: 'VALIDATION_ERROR' },
                            field: { type: 'string', example: 'email' },
                        },
                    },
                    requestId: { type: 'string', example: '2f1c9a7e-7b4d-4c2f-9a10-5b2c3d4e5f60' },
                },
            },
            SuccessMessage: {
                type: 'object',
                properties: {
                    status: { type: 'string', example: 'success' },
                    message: { type: 'string', example: 'İşlem başarıyla tamamlandı.' },
                },
            },
            User: {
                type: 'object',
                description: 'Kullanıcı belgesi (hassas alanlar — şifre, token sırları — yanıtta yer almaz).',
                properties: {
                    _id: { type: 'string', example: '652f1a9b2c4d5e6f7a8b9c0d' },
                    name: { type: 'string', example: 'Ahmet Yılmaz' },
                    username: { type: 'string', example: 'ahmet_rider' },
                    email: { type: 'string', format: 'email', example: 'ahmet@example.com' },
                    avatar: { type: 'string', example: 'https://api.motonom.app/api/uploads/avatar.png' },
                    coverImage: { type: 'string', example: 'https://api.motonom.app/api/uploads/cover.jpg' },
                    bio: { type: 'string', example: 'Hafta sonu gezgini 🏍️' },
                    userType: { type: 'string', enum: ['INDIVIDUAL', 'PROFESSIONAL'], example: 'INDIVIDUAL' },
                    activeProfileMode: { type: 'string', enum: ['PERSONAL', 'PROFESSIONAL'], example: 'PERSONAL' },
                    isAdmin: { type: 'boolean', example: false },
                    isVerified: { type: 'boolean', example: true },
                    verificationStatus: { type: 'string', enum: ['none', 'pending', 'approved', 'rejected'], example: 'approved' },
                    isPro: { type: 'boolean', example: false },
                    isPremium: { type: 'boolean', example: false },
                    isPhoneVerified: { type: 'boolean', example: true },
                    rank: { type: 'string', example: 'Çaylak Sürücü' },
                    points: { type: 'integer', example: 120 },
                    primaryBike: { type: 'string', example: 'Yamaha MT-07' },
                    bikeModel: { type: 'string', example: 'MT-07' },
                    location: { type: 'string', example: 'İstanbul' },
                    phone: { type: 'string', example: '+905551112233' },
                    ridingPace: { type: 'string', enum: ['CHILL', 'TOURING', 'SPORT', 'TRACK'], nullable: true, example: 'SPORT' },
                    totalKm: { type: 'number', example: 4250.5 },
                    topSpeed: { type: 'number', example: 198 },
                    followers: { type: 'integer', description: 'Takipçi sayısı (liste değil, sayı olarak döner).', example: 342 },
                    following: { type: 'integer', example: 128 },
                    garage: { type: 'array', items: { $ref: '#/components/schemas/GarageBike' } },
                    businessProfile: { $ref: '#/components/schemas/BusinessProfile' },
                    createdAt: { type: 'string', format: 'date-time', example: '2026-01-15T10:30:00.000Z' },
                    updatedAt: { type: 'string', format: 'date-time', example: '2026-10-20T08:12:00.000Z' },
                },
            },
            GarageBike: {
                type: 'object',
                properties: {
                    _id: { type: 'string', example: '652f1a9b2c4d5e6f7a8b9c0e' },
                    brand: { type: 'string', example: 'Yamaha' },
                    model: { type: 'string', example: 'MT-07' },
                    year: { type: 'integer', example: 2023 },
                    image: { type: 'string', nullable: true, example: 'https://api.motonom.app/api/uploads/bike.jpg' },
                    km: { type: 'integer', example: 12500 },
                    color: { type: 'string', example: 'Icon Blue' },
                    cc: { type: 'integer', example: 689 },
                    hp: { type: 'integer', example: 73 },
                    style: {
                        type: 'string',
                        enum: ['NAKED', 'RACING', 'ENDURO', 'CHOPPER', 'SCOOTER', 'TOURING', 'ADVENTURE', 'CRUISER', 'SPORT', 'CUSTOM', 'UNKNOWN'],
                        example: 'NAKED',
                    },
                    isPrimary: { type: 'boolean', example: true },
                    isVerified: { type: 'boolean', example: false },
                    verificationStatus: { type: 'string', enum: ['none', 'pending', 'approved', 'rejected'], example: 'none' },
                },
            },
            BusinessProfile: {
                type: 'object',
                description: 'MotoVibe BİZ işletme profili (yalnızca PROFESSIONAL kullanıcılarda dolu).',
                properties: {
                    category: { type: 'string', enum: ['SERVICE', 'STORE', 'CAFE', 'RENTAL', 'INFLUENCER'], example: 'SERVICE' },
                    businessName: { type: 'string', example: 'Ducati İstanbul Garaj' },
                    businessDescription: { type: 'string', example: 'Yetkili servis ve aksesuar mağazası.' },
                    businessPhone: { type: 'string', example: '+902121234567' },
                    verifiedBadge: { type: 'boolean', example: true },
                    ratingAverage: { type: 'number', example: 4.7 },
                    ratingCount: { type: 'integer', example: 212 },
                    acceptsAppointments: { type: 'boolean', example: true },
                    services: { type: 'array', items: { type: 'string' }, example: ['Bakım', 'Lastik', 'Yıkama'] },
                },
            },
            CatalogItem: {
                type: 'object',
                description: 'İşletme kataloğu hizmet/ürün öğesi.',
                properties: {
                    name: { type: 'string', maxLength: 80, example: 'Tam Bakım' },
                    category: { type: 'string', maxLength: 40, example: 'Servis' },
                    price: { type: 'number', minimum: 0, example: 1200 },
                    discountPrice: { type: 'number', minimum: 0, example: 999 },
                    durationMin: { type: 'integer', minimum: 15, maximum: 480, example: 90 },
                    apexBonus: { type: 'number', minimum: 0, example: 50 },
                    stock: { type: 'integer', minimum: 0, example: 10 },
                    imageUrl: { type: 'string', maxLength: 400 },
                    description: { type: 'string', maxLength: 280 },
                    isActive: { type: 'boolean', example: true },
                },
            },
            AuthSession: {
                type: 'object',
                description: 'Başarılı kayıt/giriş/yenileme yanıtı. Token hem kök düzeyde hem de `data` altında döner.',
                properties: {
                    status: { type: 'string', example: 'success' },
                    token: { type: 'string', description: 'JWT access token', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                    refreshToken: { type: 'string', description: 'Opak refresh token', example: 'a1b2c3d4-...' },
                    data: {
                        type: 'object',
                        properties: {
                            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                            refreshToken: { type: 'string', example: 'a1b2c3d4-...' },
                            user: { $ref: '#/components/schemas/User' },
                        },
                    },
                },
            },
            Tag: {
                type: 'object',
                properties: {
                    _id: { type: 'string', example: '652f1a9b2c4d5e6f7a8b9c0f' },
                    name: { type: 'string', description: 'Normalize edilmiş (küçük harf) etiket adı.', example: 'motogezi' },
                    displayName: { type: 'string', example: '#MotoGezi' },
                    postCount: { type: 'integer', example: 1280 },
                    followerCount: { type: 'integer', example: 540 },
                    lastUsedAt: { type: 'string', format: 'date-time', example: '2026-10-22T19:45:00.000Z' },
                    isFollowing: { type: 'boolean', description: 'İsteği yapan kullanıcı bu etiketi takip ediyor mu.', example: false },
                },
            },
            TagFollowResult: {
                type: 'object',
                properties: {
                    name: { type: 'string', example: 'motogezi' },
                    followerCount: { type: 'integer', example: 541 },
                    isFollowing: { type: 'boolean', example: true },
                },
            },
            AdTargetAudience: {
                type: 'object',
                properties: {
                    minCcRequirement: { type: 'integer', example: 600 },
                    cities: { type: 'array', items: { type: 'string' }, example: ['İstanbul', 'Ankara'] },
                },
            },
            AdPackage: {
                type: 'object',
                properties: {
                    id: { type: 'string', enum: ['starter', 'pro', 'biz_garaj', 'enterprise'], example: 'pro' },
                    name: { type: 'string', example: 'Pro Rider Vitrini' },
                    targetImpressions: { type: 'integer', example: 5000 },
                    amount: { type: 'number', example: 699 },
                    currency: { type: 'string', example: 'TRY' },
                    description: { type: 'string', example: 'Tüm motosiklet tutkunlarına ulaşan en popüler paket.' },
                    badge: { type: 'string', example: '5.000 GÖSTERİM' },
                    isPopular: { type: 'boolean', example: true },
                    cpm: { type: 'string', example: '₺0.14 / gösterim' },
                },
            },
            Ad: {
                type: 'object',
                description: 'Sponsorlu reklam belgesi (SponsoredAd).',
                properties: {
                    _id: { type: 'string', example: '652f1a9b2c4d5e6f7a8b9c10' },
                    userId: { type: 'string', nullable: true, example: '652f1a9b2c4d5e6f7a8b9c0d' },
                    adType: { type: 'string', enum: ['biz', 'user'], example: 'biz' },
                    businessName: { type: 'string', example: 'Ducati İstanbul Garaj' },
                    businessProfilePic: { type: 'string', example: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=500' },
                    mediaUrls: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1000'],
                    },
                    caption: { type: 'string', example: '2026 Panigale V4 S lansmanına özel servis günleri!' },
                    ctaText: { type: 'string', enum: ['Detaylı Bilgi', 'Satın Al', 'Randevu Al'], example: 'Randevu Al' },
                    ctaLink: { type: 'string', example: 'https://motovibe.app/biz/ducati-istanbul' },
                    targetAudience: { $ref: '#/components/schemas/AdTargetAudience' },
                    isActive: { type: 'boolean', example: true },
                    isCompleted: { type: 'boolean', example: false },
                    payment: {
                        type: 'object',
                        properties: {
                            packageId: { type: 'string', enum: ['starter', 'pro', 'biz_garaj', 'enterprise'], example: 'biz_garaj' },
                            packageName: { type: 'string', example: 'MotoVibe BİZ Garaj' },
                            amount: { type: 'number', example: 1499 },
                            currency: { type: 'string', example: 'TRY' },
                            targetImpressions: { type: 'integer', example: 15000 },
                            status: { type: 'string', enum: ['pending', 'paid', 'failed', 'refunded'], example: 'paid' },
                            paymentMethod: { type: 'string', example: 'credit_card' },
                            transactionId: { type: 'string', example: 'TXN_1718120000000_ABCDE' },
                            paidAt: { type: 'string', format: 'date-time', example: '2026-10-20T08:00:00.000Z' },
                        },
                    },
                    metrics: {
                        type: 'object',
                        properties: {
                            impressions: { type: 'integer', example: 142 },
                            uniqueReach: { type: 'integer', example: 118 },
                            clicks: { type: 'integer', example: 28 },
                        },
                    },
                    ctr: { type: 'string', description: 'Yalnızca liste uçlarında hesaplanır.', example: '19.72%' },
                    createdAt: { type: 'string', format: 'date-time', example: '2026-10-19T12:00:00.000Z' },
                },
            },
        },
        responses: {
            UnauthorizedError: {
                description: 'Kimlik doğrulama gerekli veya token geçersiz.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            ForbiddenError: {
                description: 'Bu işlem için yetki yok.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            NotFoundError: {
                description: 'Kayıt bulunamadı.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            ValidationError: {
                description: 'Geçersiz istek gövdesi veya parametreleri.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            ServerError: {
                description: 'Beklenmeyen sunucu hatası.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
        },
    },
};

const swaggerSpec = swaggerJSDoc({
    definition,
    // Scan route files + app.js for `@openapi` JSDoc annotations. Files without
    // annotations simply contribute nothing, so the glob can be broad.
    apis: [
        path.join(__dirname, 'app.js'),
        path.join(__dirname, 'modules/**/routes.js'),
        path.join(__dirname, 'modules/**/*.routes.js'),
    ],
});

export default swaggerSpec;
