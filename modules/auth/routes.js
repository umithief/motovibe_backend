import { rateLimitError } from '../../middleware/rateLimitError.js';
import * as controller from './controller.js';
import { RESET_WINDOW_MS, RESET_MAX_ATTEMPTS, RESET_TOKEN_TTL, EMAIL_PATTERN, normalizeEmail, hashResetCode, secureHexEqual, genericRecoveryMessage } from './rules.service.js';


import express from 'express';
import rateLimit from 'express-rate-limit';

import { protect } from "../../middleware/authMiddleware.js";


const router = express.Router();

const limiter = (max, message) => rateLimit({
    handler:rateLimitError,
    windowMs: RESET_WINDOW_MS,
    max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { status: 'error', message },
});

const forgotPasswordLimiter = limiter(
    5,
    'Cok fazla sifre sifirlama istegi. Lutfen daha sonra tekrar deneyin.',
);
const verificationLimiter = limiter(
    10,
    'Cok fazla dogrulama denemesi. Lutfen yeni kod isteyin.',
);
const refreshLimiter = limiter(
    30,
    'Cok fazla oturum yenileme istegi. Lutfen tekrar giris yapin.',
);

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Şifre sıfırlama kodu gönder
 *     description: Verilen e-postaya ait hesap varsa 6 haneli bir sıfırlama kodu (OTP) e-posta ile gönderilir. Hesabın var olup olmadığını sızdırmamak için yanıt her zaman aynıdır. Dakikada en çok 5 istek (rate limit).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: ahmet@example.com }
 *     responses:
 *       200:
 *         description: İstek alındı (hesap mevcutsa e-posta gönderildi).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessage' }
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         description: Çok fazla istek (rate limit).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       503:
 *         description: E-posta servisi kapalı.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/forgot-password', forgotPasswordLimiter, controller.postForgotPassword);

/**
 * @openapi
 * /api/auth/verify-code:
 *   post:
 *     tags: [Auth]
 *     summary: Sıfırlama kodunu doğrula
 *     description: E-posta ve 6 haneli kodu doğrular; başarılıysa kısa ömürlü bir `resetToken` döner.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email, example: ahmet@example.com }
 *               code: { type: string, description: '6 haneli OTP', example: '123456' }
 *     responses:
 *       200:
 *         description: Kod doğrulandı.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: Kod basariyla dogrulandi. }
 *                 resetToken: { type: string, example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... }
 *                 data:
 *                   type: object
 *                   properties:
 *                     resetToken: { type: string }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         description: Çok fazla deneme (rate limit).
 */
router.post('/verify-code', verificationLimiter, controller.postVerifyCode);

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Yeni şifre belirle
 *     description: '`verify-code` ucundan alınan `resetToken` ile yeni şifre atar. Başarılı sıfırlama tüm mevcut oturumları geçersiz kılar.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resetToken, newPassword]
 *             properties:
 *               resetToken: { type: string, example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... }
 *               newPassword: { type: string, minLength: 8, maxLength: 128, example: Yeni!Sifre123 }
 *     responses:
 *       200:
 *         description: Şifre sıfırlandı.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessage' }
 *       401:
 *         description: Sıfırlama oturumu geçersiz veya süresi dolmuş.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/reset-password', verificationLimiter, controller.postResetPassword);

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Access token'ı yenile
 *     description: Geçerli bir refresh token ile yeni access + refresh token çifti üretir (token rotation). Kullanılmış bir token tekrar sunulursa tüm oturum ailesi iptal edilir.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string, example: a1b2c3d4-e5f6-... }
 *     responses:
 *       200:
 *         description: Yeni token çifti üretildi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 token: { type: string }
 *                 refreshToken: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     token: { type: string }
 *                     refreshToken: { type: string }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         description: Çok fazla yenileme isteği (rate limit).
 */
router.post('/refresh', refreshLimiter, controller.postRefresh);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Oturumu kapat
 *     description: Verilen refresh token'ı iptal eder. Token verilmese bile 204 döner.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string, example: a1b2c3d4-e5f6-... }
 *     responses:
 *       204:
 *         description: Oturum kapatıldı (gövde yok).
 */
router.post('/logout', controller.postLogout);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Geçerli kullanıcıyı getir
 *     description: Access token'a ait kullanıcının tam profilini döner.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Kullanıcı profili.
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
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/me', protect, controller.getMe);

export {
    hashResetCode,
    secureHexEqual,
};

export default router;
