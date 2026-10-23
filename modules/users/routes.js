import { rateLimitError } from '../../middleware/rateLimitError.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { admin, protect, checkUser } from "../../middleware/authMiddleware.js";
import * as userController from "./controller.js";
import { mentionSearch } from "./mention.controller.js";
import { getProfileThemeCatalog, getProfileThemeDetail, updateProfileTheme, resetProfileTheme } from "./profileTheme.controller.js";
import { createLegacyRide } from "../rides/controller.js";

const router = express.Router();

const businessUpgradeLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'İşletme hesabı geçişi için saatlik limiti doldurdunuz. Lütfen daha sonra tekrar deneyin.'
    }
});

const businessFlashLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Kampanya işlem limitine ulaştınız. Lütfen daha sonra tekrar deneyin.'
    }
});

const phoneOtpSendLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Cok fazla dogrulama kodu istendi. Lutfen daha sonra tekrar deneyin.'
    }
});

const phoneOtpVerifyLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Cok fazla dogrulama denemesi. Lutfen yeni kod isteyin.'
    }
});

// Fired per keystroke; clients debounce ~180 ms.
const mentionSearchLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 10 * 1000,
    max: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Çok hızlı arama yapıyorsun. Birkaç saniye sonra tekrar dene.'
    }
});

// Username Validation
/**
 * @openapi
 * /api/users/check-username:
 *   post:
 *     tags: [Users]
 *     summary: Kullanıcı adı uygunluğunu kontrol et
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string, example: ahmet_rider }
 *     responses:
 *       200:
 *         description: Uygunluk sonucu.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 isAvailable: { type: boolean, example: true }
 *                 username: { type: string, example: ahmet_rider }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/check-username', protect, userController.checkUsernameAvailability);

// Auth Routes
/**
 * @openapi
 * /api/users/register:
 *   post:
 *     tags: [Users]
 *     summary: Yeni kullanıcı kaydı
 *     description: Yeni hesap oluşturur ve access + refresh token döner. Rate limit uygulanır.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 80, example: Ahmet Yılmaz }
 *               email: { type: string, format: email, example: ahmet@example.com }
 *               password: { type: string, minLength: 8, maxLength: 128, example: Gizli!Sifre123 }
 *               username: { type: string, description: 'Opsiyonel; verilmezse e-postadan türetilir.', example: ahmet_rider }
 *               bikeModel: { type: string, example: Yamaha MT-07 }
 *     responses:
 *       201:
 *         description: Kayıt başarılı.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       409:
 *         description: E-posta veya kullanıcı adı zaten kullanımda.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         description: Çok fazla istek (rate limit).
 */
router.post('/register', userController.registerUser);

/**
 * @openapi
 * /api/users/login:
 *   post:
 *     tags: [Users]
 *     summary: Giriş yap
 *     description: E-posta ve şifre ile giriş yapar; access + refresh token döner. Rate limit uygulanır.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: ahmet@example.com }
 *               password: { type: string, example: Gizli!Sifre123 }
 *     responses:
 *       200:
 *         description: Giriş başarılı.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Hatalı e-posta veya şifre.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Hesap kapatılmış.
 *       429:
 *         description: Çok fazla istek (rate limit).
 */
router.post('/login', userController.loginUser);

// Onboarding (Ignition Flow)
/**
 * @openapi
 * /api/users/onboard:
 *   post:
 *     tags: [Users]
 *     summary: Onboarding (ateşleme akışı) tamamla
 *     description: Takma ad, telefon ve ilk motosikleti ayarlar; yeni oturum token'ları döner.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nickname]
 *             properties:
 *               nickname: { type: string, example: ahmet_rider }
 *               phone: { type: string, example: '+905551112233' }
 *               bike:
 *                 type: object
 *                 properties:
 *                   brand: { type: string, example: Yamaha }
 *                   model: { type: string, example: MT-07 }
 *                   year: { type: integer, example: 2023 }
 *                   style: { type: string, example: NAKED }
 *     responses:
 *       200:
 *         description: Onboarding tamamlandı.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/onboard', protect, userController.onboardUser);

/**
 * @openapi
 * /api/users/send-phone-otp:
 *   post:
 *     tags: [Users]
 *     summary: Telefon doğrulama kodu gönder
 *     description: Verilen telefona SMS ile 6 haneli OTP gönderir (10 dk geçerli). `/api/users/request-phone-otp` aynı davranışı sağlayan takma addır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: '+905551112233' }
 *     responses:
 *       200:
 *         description: Kod gönderildi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string }
 *                 phone: { type: string, example: '+905551112233' }
 *                 isMock: { type: boolean, example: true }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Çok fazla kod isteği (rate limit).
 */
router.post('/send-phone-otp', protect, phoneOtpSendLimiter, userController.sendPhoneOtp);

/**
 * @openapi
 * /api/users/request-phone-otp:
 *   post:
 *     tags: [Users]
 *     summary: Telefon doğrulama kodu gönder (takma ad)
 *     description: '`/api/users/send-phone-otp` ile aynı işlevi görür.'
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: '+905551112233' }
 *     responses:
 *       200:
 *         description: Kod gönderildi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/request-phone-otp', protect, phoneOtpSendLimiter, userController.sendPhoneOtp);

/**
 * @openapi
 * /api/users/verify-phone:
 *   post:
 *     tags: [Users]
 *     summary: Telefon numarasını doğrula
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone: { type: string, example: '+905551112233' }
 *               otp: { type: string, description: '6 haneli kod', example: '123456' }
 *     responses:
 *       200:
 *         description: Telefon doğrulandı.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 verified: { type: boolean, example: true }
 *                 phone: { type: string }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Çok fazla deneme (rate limit).
 */
router.post('/verify-phone', protect, phoneOtpVerifyLimiter, userController.verifyPhone);

const telemetryLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        status: 'error',
        message: 'Telemetri gönderme sıklık limitine ulaştınız. Lütfen bekleyin.'
    }
});

// Profile theme catalog is previewable by all plans. Mutations are owner-only.
/**
 * @openapi
 * /api/users/profile-themes:
 *   get:
 *     tags: [Users]
 *     summary: Profil tema kataloğu
 *     description: Tüm planlar tarafından önizlenebilir tema kataloğunu döner.
 *     responses:
 *       200:
 *         description: Katalog.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     catalogVersion: { type: integer, example: 3 }
 *                     themes: { type: array, items: { type: object } }
 */
router.get('/profile-themes', getProfileThemeCatalog);

/**
 * @openapi
 * /api/users/profile-themes/{themeId}:
 *   get:
 *     tags: [Users]
 *     summary: Tek tema detayı
 *     parameters:
 *       - in: path
 *         name: themeId
 *         required: true
 *         schema: { type: string }
 *         example: neon-apex
 *     responses:
 *       200:
 *         description: Tema detayı.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/profile-themes/:themeId', getProfileThemeDetail);

/**
 * @openapi
 * /api/users/profile/theme:
 *   patch:
 *     tags: [Users]
 *     summary: Profil temasını güncelle
 *     description: 'Aktif profil temasını değiştirir. PRO gerektiren temalar için APEX üyelik aranır. `configVersion` katalog sürümüyle eşleşmelidir.'
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [themeId, configVersion]
 *             properties:
 *               themeId: { type: string, example: neon-apex }
 *               configVersion: { type: integer, example: 2 }
 *     responses:
 *       200:
 *         description: Tema güncellendi.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Tema için aktif PRO üyeliği gerekli.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       409:
 *         description: Tema sürümü desteklenmiyor (katalog yenilenmeli).
 *   delete:
 *     tags: [Users]
 *     summary: Profil temasını sıfırla
 *     description: Temayı varsayılana döndürür.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tema sıfırlandı.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch('/profile/theme', protect, updateProfileTheme);
router.delete('/profile/theme', protect, resetProfileTheme);

// Profile (Me)
/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: '[Admin] Tüm kullanıcıları listele'
 *     description: Sayfalı kullanıcı listesi (admin yetkisi gerekir).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: userType
 *         schema: { type: string, enum: [INDIVIDUAL, PROFESSIONAL] }
 *       - in: query
 *         name: isVerified
 *         schema: { type: string, enum: ['true', 'false'] }
 *     responses:
 *       200:
 *         description: Kullanıcı listesi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 20 }
 *                 total: { type: integer, example: 1540 }
 *                 hasMore: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/User' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/', protect, admin, userController.getAllUsers);

/**
 * @openapi
 * /api/users/profile:
 *   get:
 *     tags: [Users]
 *     summary: Kendi profilimi getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profil (takipçi sayıları ve son gönderilerle).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/User' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   put:
 *     tags: [Users]
 *     summary: Profili güncelle
 *     description: 'İzin verilen alanlar: name, email, username, bio, location, coverImage, avatar, phone, emergencyPhone, address, bioBlocks, ridingPace. Şifre bu uçtan değiştirilemez. `PATCH` aynı işlevi görür.'
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: Ahmet Yılmaz }
 *               username: { type: string, example: ahmet_rider }
 *               email: { type: string, format: email }
 *               bio: { type: string, maxLength: 150, example: 'Hafta sonu gezgini 🏍️' }
 *               location: { type: string, example: İstanbul }
 *               avatar: { type: string }
 *               coverImage: { type: string }
 *               phone: { type: string }
 *               emergencyPhone: { type: string }
 *               address: { type: string }
 *               ridingPace: { type: string, enum: [CHILL, TOURING, SPORT, TRACK] }
 *               bioBlocks: { type: array, items: { type: object }, description: 'Zengin bio blokları (doğrulanır ve sanitize edilir).' }
 *     responses:
 *       200:
 *         description: Profil güncellendi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/User' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       409:
 *         description: E-posta başka bir hesapta kullanılıyor.
 *   patch:
 *     tags: [Users]
 *     summary: Profili güncelle (PUT ile aynı — Rider Identity Config)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Profil güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   delete:
 *     tags: [Users]
 *     summary: Hesabımı sil (KVKK/GDPR)
 *     description: Hesabı soft-delete yapar, kişisel içerikleri gizler/temizler ve oturumları sonlandırır.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Hesap silindi.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessage' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/profile', protect, userController.getMe);
router.put('/profile', protect, userController.updateProfile);
router.delete('/profile', protect, userController.deleteMyAccount);
router.patch('/profile', protect, userController.updateProfile); // Rider Identity Config (Unified)

/**
 * @openapi
 * /api/users/profile/bio:
 *   put:
 *     tags: [Users]
 *     summary: Bio bloklarını güncelle
 *     description: 'Zengin bio bloklarını günceller (updateProfile mantığını kullanır).'
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bioBlocks: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Bio güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.put('/profile/bio', protect, userController.updateProfile); // Bio blocks use same updateProfile logic

/**
 * @openapi
 * /api/users/update-settings:
 *   put:
 *     tags: [Users]
 *     summary: Gizlilik ve bildirim ayarlarını güncelle
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               privacy:
 *                 type: object
 *                 properties:
 *                   isPrivate: { type: boolean, example: false }
 *                   hideLocation: { type: boolean, example: false }
 *               notifications:
 *                 type: object
 *                 properties:
 *                   likes: { type: boolean, example: true }
 *                   comments: { type: boolean, example: true }
 *                   follows: { type: boolean, example: true }
 *                   pushEnabled: { type: boolean, example: true }
 *     responses:
 *       200:
 *         description: Ayarlar güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.put('/update-settings', protect, userController.updateSettings);

/**
 * @openapi
 * /api/users/update-password:
 *   patch:
 *     tags: [Users]
 *     summary: Şifreyi değiştir
 *     description: Mevcut şifreyi doğrular, yeni şifreyi atar ve diğer oturumları sonlandırır. Yeni token çifti döner.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, password, passwordConfirm]
 *             properties:
 *               currentPassword: { type: string, example: Eski!Sifre123 }
 *               password: { type: string, minLength: 8, maxLength: 128, example: Yeni!Sifre123 }
 *               passwordConfirm: { type: string, example: Yeni!Sifre123 }
 *     responses:
 *       200:
 *         description: Şifre güncellendi.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Mevcut şifre hatalı veya kimlik doğrulama yok.
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.patch('/update-password', protect, userController.updatePassword);
/**
 * @openapi
 * /api/users/ghost-mode:
 *   patch:
 *     tags: [Users]
 *     summary: Ghost Mode aç/kapat (PRO/APEX)
 *     description: Radar görünmezlik modunu değiştirir. Yalnızca aktif APEX/PRO üyelere açıktır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isGhostMode: { type: boolean, description: 'Belirtilmezse mevcut durum tersine çevrilir.', example: true }
 *     responses:
 *       200:
 *         description: Durum güncellendi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     isGhostMode: { type: boolean, example: true }
 *                 message: { type: string }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: PRO/APEX üyelik gerekli.
 */
router.patch('/ghost-mode', protect, userController.toggleGhostMode); // PRO: Ghost Mode

/**
 * @openapi
 * /api/users/telemetry:
 *   patch:
 *     tags: [Users]
 *     summary: Sürüş telemetrisi kaydet
 *     description: 'Tek sürüşün mesafe/hız/yatış açısı verisini kaydeder. Sınırlar: mesafe ≤ 300 km, hız ≤ 299 km/s, yatış ≤ 65°. Rate limit uygulanır.'
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               distanceKm: { type: number, example: 42.5 }
 *               topSpeed: { type: number, example: 165 }
 *               maxLeanAngle: { type: number, example: 38 }
 *               city: { type: string, example: İstanbul }
 *               cityName: { type: string, example: İstanbul }
 *     responses:
 *       200:
 *         description: Telemetri kaydedildi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalKm: { type: number, example: 4292.5 }
 *                     topSpeed: { type: number, example: 198 }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Çok sık gönderim (rate limit).
 */
router.patch('/telemetry', protect, telemetryLimiter, userController.saveTelemetry); // Ride Telemetry

/**
 * @openapi
 * /api/users/push-token:
 *   post:
 *     tags: [Users]
 *     summary: Push bildirim token'ı kaydet
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, maxLength: 512, example: fcm-token-abc123 }
 *               platform: { type: string, enum: [android, ios, web], example: android }
 *     responses:
 *       200:
 *         description: Token kaydedildi.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessage' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   delete:
 *     tags: [Users]
 *     summary: Push bildirim token'ını sil
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, example: fcm-token-abc123 }
 *     responses:
 *       200:
 *         description: Token silindi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/push-token', protect, userController.registerPushToken);
router.delete('/push-token', protect, userController.unregisterPushToken);
/**
 * @openapi
 * /api/users/business-profile:
 *   patch:
 *     tags: [Users]
 *     summary: İşletme profilini güncelle (MotoVibe BİZ)
 *     description: PROFESSIONAL kullanıcının işletme profil alanlarını günceller.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/BusinessProfile' }
 *     responses:
 *       200:
 *         description: İşletme profili güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch('/business-profile', protect, userController.updateBusinessProfile);

/**
 * @openapi
 * /api/users/business-tax-id:
 *   get:
 *     tags: [Users]
 *     summary: İşletme vergi kimliğini getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vergi kimliği.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/business-tax-id', protect, userController.getBusinessTaxId);

/**
 * @openapi
 * /api/users/business-catalog:
 *   get:
 *     tags: [Users]
 *     summary: İşletme kataloğunu getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Katalog öğeleri.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   put:
 *     tags: [Users]
 *     summary: İşletme kataloğunu toplu güncelle
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               catalogItems:
 *                 type: array
 *                 items: { $ref: '#/components/schemas/CatalogItem' }
 *     responses:
 *       200:
 *         description: Katalog güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/business-catalog', protect, userController.getBusinessCatalog);
router.put('/business-catalog', protect, userController.updateBusinessCatalog);

/**
 * @openapi
 * /api/users/business-catalog/items:
 *   post:
 *     tags: [Users]
 *     summary: Katalog öğesi ekle
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CatalogItem' }
 *     responses:
 *       201:
 *         description: Öğe eklendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/business-catalog/items', protect, userController.createBusinessCatalogItem);

/**
 * @openapi
 * /api/users/business-catalog/items/{itemId}:
 *   patch:
 *     tags: [Users]
 *     summary: Katalog öğesini güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CatalogItem' }
 *     responses:
 *       200:
 *         description: Öğe güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   delete:
 *     tags: [Users]
 *     summary: Katalog öğesini sil
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Öğe silindi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.patch('/business-catalog/items/:itemId', protect, userController.updateBusinessCatalogItem);
router.delete('/business-catalog/items/:itemId', protect, userController.deleteBusinessCatalogItem);

/**
 * @openapi
 * /api/users/business-flash-offers:
 *   get:
 *     tags: [Users]
 *     summary: İşletmenin flash kampanyalarını getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Flash kampanya listesi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   post:
 *     tags: [Users]
 *     summary: Flash kampanya oluştur
 *     description: Rate limit uygulanır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, maxLength: 80, example: 'Hafta sonu %20 yağ değişimi' }
 *               description: { type: string, maxLength: 220 }
 *               discountRate: { type: number, minimum: 0, maximum: 95, example: 20 }
 *               targetRadiusKm: { type: number, minimum: 1, maximum: 300, example: 20 }
 *               validUntil: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Kampanya oluşturuldu.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Kampanya işlem limiti (rate limit).
 */
router.get('/business-flash-offers', protect, userController.getBusinessFlashOffers);

/**
 * @openapi
 * /api/users/business-flash-offers/nearby:
 *   get:
 *     tags: [Users]
 *     summary: Yakındaki flash kampanyalar
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Yakındaki kampanyalar.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/business-flash-offers/nearby', protect, userController.getNearbyBusinessFlashOffers);
router.post('/business-flash-offers', protect, businessFlashLimiter, userController.createBusinessFlashOffer);

/**
 * @openapi
 * /api/users/business-flash-offers/{offerId}/cancel:
 *   patch:
 *     tags: [Users]
 *     summary: Flash kampanyayı iptal et
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: offerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kampanya iptal edildi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.patch('/business-flash-offers/:offerId/cancel', protect, userController.cancelBusinessFlashOffer);

/**
 * @openapi
 * /api/users/profile-mode:
 *   patch:
 *     tags: [Users]
 *     summary: Aktif profil modunu değiştir (PERSONAL/PROFESSIONAL)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               activeProfileMode: { type: string, enum: [PERSONAL, PROFESSIONAL], example: PROFESSIONAL }
 *     responses:
 *       200:
 *         description: Mod güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch('/profile-mode', protect, userController.updateProfileMode);
/**
 * @openapi
 * /api/users/pro/offers:
 *   get:
 *     tags: [Users]
 *     summary: PRO abonelik tekliflerini getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Teklif listesi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/pro/offers', protect, userController.getProOffers);

/**
 * @openapi
 * /api/users/pro/subscribe:
 *   post:
 *     tags: [Users]
 *     summary: PRO aboneliği başlat
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               offerId: { type: string, enum: [pro_monthly, pro_yearly, pro_lifetime], example: pro_yearly }
 *     responses:
 *       200:
 *         description: Abonelik işlendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
    router.post('/pro/subscribe', protect, userController.subscribeToPro);

/**
 * @openapi
 * /api/users/pro/restore:
 *   post:
 *     tags: [Users]
 *     summary: PRO aboneliğini geri yükle
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Abonelik geri yüklendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
    router.post('/pro/restore', protect, userController.restoreProSubscription);

/**
 * @openapi
 * /api/users/upgrade-pro:
 *   post:
 *     tags: [Users]
 *     summary: PRO'ya yükselt (MotoVibe BİZ)
 *     description: Rate limit uygulanır.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Yükseltme yapıldı.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Saatlik geçiş limiti (rate limit).
 */
    router.post('/upgrade-pro', protect, businessUpgradeLimiter, userController.upgradeToPro); // MotoVibe BİZ

/**
 * @openapi
 * /api/users/downgrade-pro:
 *   post:
 *     tags: [Users]
 *     summary: PRO'yu kapat
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PRO kapatıldı.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
    router.post('/downgrade-pro', protect, userController.downgradeFromPro); // MotoVibe BİZ: Kapat

/**
 * @openapi
 * /api/users/upgrade-business:
 *   post:
 *     tags: [Users]
 *     summary: İşletme hesabına yükselt
 *     description: Rate limit uygulanır.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: İşletme hesabına geçildi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Saatlik geçiş limiti (rate limit).
 */
    router.post('/upgrade-business', protect, businessUpgradeLimiter, userController.upgradeToBusiness);

/**
 * @openapi
 * /api/users/downgrade-business:
 *   post:
 *     tags: [Users]
 *     summary: İşletme hesabını kapat
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: İşletme hesabı kapatıldı.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
    router.post('/downgrade-business', protect, userController.downgradeFromBusiness);

/**
 * @openapi
 * /api/users/rides:
 *   post:
 *     tags: [Users]
 *     summary: Eski (legacy) sürüş kaydet
 *     description: Geriye dönük uyumluluk için eski sürüş kayıt gövdesini kabul eder.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       201:
 *         description: Sürüş kaydedildi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
    router.post('/rides', protect, createLegacyRide); // Backward compatibility for legacy ride save payload

/**
 * @openapi
 * /api/users/fuel-efficiency:
 *   post:
 *     tags: [Users]
 *     summary: Yakıt verimliliği hesapla
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               distanceKm: { type: number, example: 320 }
 *               liters: { type: number, example: 12.4 }
 *     responses:
 *       200:
 *         description: Hesaplama sonucu.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
    router.post('/fuel-efficiency', protect, userController.calculateFuelEfficiency);

/**
 * @openapi
 * /api/users/achievements/all:
 *   get:
 *     tags: [Users]
 *     summary: Tüm başarımları (achievements) getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Başarım listesi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
    router.get('/achievements/all', protect, userController.getAllAchievements);

/**
 * @openapi
 * /api/users/achievements/seed:
 *   post:
 *     tags: [Users]
 *     summary: '[Admin] Varsayılan başarımları yükle'
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Başarımlar yüklendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
    router.post('/achievements/seed', protect, admin, userController.seedAchievements);

// Cockpit Illumination (Dynamic Custom Vibe) — APEX only
/**
 * @openapi
 * /api/users/preferences/theme:
 *   put:
 *     tags: [Users]
 *     summary: Kokpit aydınlatması (accent rengi) güncelle
 *     description: 'Moto-Palette listesinden bir hex renk ayarlar. Ücretsiz renkler dışındakiler APEX üyelik gerektirir.'
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accentColor]
 *             properties:
 *               accentColor: { type: string, pattern: '^#[0-9A-Fa-f]{6}$', example: '#E2FF3B' }
 *     responses:
 *       200:
 *         description: Renk güncellendi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     accentColor: { type: string, example: '#E2FF3B' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: APEX üyelik gerekli.
 */
router.put('/preferences/theme', protect, userController.updateThemePreference);

// Cart (Must be before /:id)

// Social Actions
/**
 * @openapi
 * /api/users/follow/{id}:
 *   post:
 *     tags: [Users]
 *     summary: Kullanıcıyı takip et / takibi aç-kapa
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Takip edilecek kullanıcının id'si.
 *     responses:
 *       200:
 *         description: Takip durumu güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   delete:
 *     tags: [Users]
 *     summary: Kullanıcı takibini bırak
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Takip bırakıldı.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/follow/:id', protect, userController.toggleFollow);
router.delete('/follow/:id', protect, userController.toggleFollow);

// Garage
/**
 * @openapi
 * /api/users/garage:
 *   get:
 *     tags: [Users]
 *     summary: Garajımı getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Garajdaki motosikletler.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/GarageBike' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   post:
 *     tags: [Users]
 *     summary: Garaja motosiklet ekle
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/GarageBike' }
 *     responses:
 *       201:
 *         description: Motosiklet eklendi.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/garage', protect, userController.getGarage);
router.post('/garage', protect, userController.addToGarage);

/**
 * @openapi
 * /api/users/garage/primary:
 *   put:
 *     tags: [Users]
 *     summary: Birincil (primary) motosikleti ayarla
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               garageId: { type: string, example: 652f1a9b2c4d5e6f7a8b9c0e }
 *     responses:
 *       200:
 *         description: Birincil motosiklet güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.put('/garage/primary', protect, userController.setPrimaryBike);

/**
 * @openapi
 * /api/users/garage/{garageId}:
 *   put:
 *     tags: [Users]
 *     summary: Garaj öğesini güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: garageId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/GarageBike' }
 *     responses:
 *       200:
 *         description: Güncellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   delete:
 *     tags: [Users]
 *     summary: Garaj öğesini sil
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: garageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Silindi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put('/garage/:garageId', protect, userController.updateGarageItem); // Added

/**
 * @openapi
 * /api/users/garage/{garageId}/verify:
 *   post:
 *     tags: [Users]
 *     summary: Garaj öğesi doğrulama talebi
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: garageId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               verificationImage: { type: string }
 *     responses:
 *       200:
 *         description: Doğrulama talebi alındı.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/garage/:garageId/verify', protect, userController.verifyGarageItem);

/**
 * @openapi
 * /api/users/garage/{garageId}/maintenance:
 *   post:
 *     tags: [Users]
 *     summary: Bakım kaydı ekle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: garageId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string, maxLength: 100, example: 'Yağ değişimi' }
 *               km: { type: integer, example: 12000 }
 *               cost: { type: number, example: 850 }
 *               serviceName: { type: string, example: 'Yamaha Yetkili Servis' }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Bakım kaydı eklendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/garage/:garageId/maintenance', protect, userController.addMaintenanceRecord);

/**
 * @openapi
 * /api/users/garage/{garageId}/maintenance/{recordId}:
 *   delete:
 *     tags: [Users]
 *     summary: Bakım kaydını sil
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: garageId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kayıt silindi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/garage/:garageId/maintenance/:recordId', protect, userController.deleteMaintenanceRecord);
router.delete('/garage/:garageId', protect, userController.removeFromGarage);

// Blocking
/**
 * @openapi
 * /api/users/blocked:
 *   get:
 *     tags: [Users]
 *     summary: Engellenen kullanıcıları getir
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Engellenen kullanıcı listesi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/blocked', protect, userController.getBlockedUsers);

/**
 * @openapi
 * /api/users/block/{id}:
 *   post:
 *     tags: [Users]
 *     summary: Kullanıcıyı engelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kullanıcı engellendi.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/block/:id', protect, userController.blockUser);

/**
 * @openapi
 * /api/users/unblock/{id}:
 *   post:
 *     tags: [Users]
 *     summary: Engeli kaldır
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Engel kaldırıldı.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/unblock/:id', protect, userController.unblockUser);

// Verification
/**
 * @openapi
 * /api/users/verification/request:
 *   post:
 *     tags: [Users]
 *     summary: Hesap doğrulama talebi gönder
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Başvuru alındı.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     verificationStatus: { type: string, example: pending }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/verification/request', protect, userController.requestVerification);

/**
 * @openapi
 * /api/users/verification/update:
 *   post:
 *     tags: [Users]
 *     summary: '[Admin] Doğrulama durumunu güncelle'
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, status]
 *             properties:
 *               userId: { type: string, example: 652f1a9b2c4d5e6f7a8b9c0d }
 *               status: { type: string, enum: [approved, rejected], example: approved }
 *     responses:
 *       200:
 *         description: Durum güncellendi.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/verification/update', protect, admin, userController.updateVerificationStatus);


// Search Users
/**
 * @openapi
 * /api/users/professionals:
 *   get:
 *     tags: [Users]
 *     summary: Profesyonel (işletme) profillerini listele
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profesyonel profiller.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/professionals', protect, userController.getProfessionalProfiles);

/**
 * @openapi
 * /api/users/search:
 *   get:
 *     tags: [Users]
 *     summary: Kullanıcı ara
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: İsim veya kullanıcı adı araması.
 *         example: ahmet
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Arama sonuçları.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 12 }
 *                 hasMore: { type: boolean, example: false }
 *                 data:
 *                   type: object
 *                   properties:
 *                     users:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/User' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/search', protect, userController.searchUsers);

/**
 * @openapi
 * /api/users/mention-search:
 *   get:
 *     tags: [Users]
 *     summary: '@bahsetme otomatik tamamlama'
 *     description: Düşük gecikmeli kullanıcı araması (her tuş vuruşunda). Rate limit uygulanır.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         example: ahm
 *     responses:
 *       200:
 *         description: Eşleşen kullanıcılar.
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Çok hızlı arama (rate limit).
 */
router.get('/mention-search', protect, mentionSearchLimiter, mentionSearch); // Cyber-Lens @autocomplete

/**
 * @openapi
 * /api/users/bulk:
 *   post:
 *     tags: [Users]
 *     summary: Id listesiyle kullanıcıları toplu getir
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 items: { type: string }
 *                 maxItems: 200
 *                 example: ['652f1a9b2c4d5e6f7a8b9c0d', '652f1a9b2c4d5e6f7a8b9c11']
 *     responses:
 *       200:
 *         description: Kullanıcılar (istenen sırayla).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 2 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     users:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/User' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/bulk', protect, userController.getUsersByIds);

// Public User Profile (Catch-all for GET /:id)
/**
 * @openapi
 * /api/users/{id}/followers:
 *   get:
 *     tags: [Users]
 *     summary: Kullanıcının takipçilerini getir
 *     description: Opsiyonel kimlik doğrulama (checkUser).
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Takipçi listesi.
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id/followers', checkUser, userController.getFollowersList);

/**
 * @openapi
 * /api/users/{id}/following:
 *   get:
 *     tags: [Users]
 *     summary: Kullanıcının takip ettiklerini getir
 *     description: Opsiyonel kimlik doğrulama (checkUser).
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Takip edilenler listesi.
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id/following', checkUser, userController.getFollowingList);

/**
 * @openapi
 * /api/users/{id}/bio:
 *   get:
 *     tags: [Users]
 *     summary: Kullanıcının bio bloklarını getir
 *     description: Opsiyonel kimlik doğrulama (checkUser). Gizli/kilitli profillerde boş döner.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Bio blokları.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 bioBlocks: { type: array, items: { type: object } }
 *                 isLocked: { type: boolean, example: false }
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id/bio', checkUser, userController.getUserBio);

/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Herkese açık kullanıcı profilini getir
 *     description: 'Id veya kullanıcı adı ile profil getirir. Opsiyonel kimlik doğrulama (checkUser). Gizli/engellenmiş profillerde kısıtlı veri döner.'
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Kullanıcı id'si veya kullanıcı adı.
 *         example: ahmet_rider
 *     responses:
 *       200:
 *         description: Profil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/User' }
 *                     isFollowing: { type: boolean, example: false }
 *                     isLocked: { type: boolean, example: false }
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', checkUser, userController.getProfile);

export default router;
