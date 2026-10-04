import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import User from '../models/User.js';
import { getJwtSecret } from '../config/env.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { getRuntimeCapabilities } from '../config/release.js';
import {
    createRefreshSession,
    getRefreshTokenFamilyId,
    hashOpaqueToken,
    signAccessToken,
} from '../services/sessionTokenService.js';
import { protect } from '../middleware/authMiddleware.js';
import { disconnectUserSessions } from '../socket.js';

const router = express.Router();

const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL = '10m';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limiter = (max, message) => rateLimit({
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

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const hashResetCode = (email, code) => crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${email}:${code}`, 'utf8')
    .digest('hex');

const secureHexEqual = (left, right) => {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const genericRecoveryMessage = 'Eger e-posta adresi sistemimizde kayitliysa 6 haneli dogrulama kodu gonderildi.';

router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
    try {
        if (!getRuntimeCapabilities().emailPasswordReset) {
            return res.status(503).json({ status: 'error', message: 'E-posta servisi kapalı. Destek ekibiyle iletişime geç.' });
        }
        const email = normalizeEmail(req.body?.email);
        if (!EMAIL_PATTERN.test(email) || email.length > 254) {
            return res.status(422).json({ status: 'error', message: 'Gecerli bir e-posta adresi girin.' });
        }

        const user = await User.findOne({ email, isDeleted: { $ne: true } });
        if (user) {
            const otpCode = crypto.randomInt(100000, 1000000).toString();
            const nonce = crypto.randomBytes(32).toString('base64url');
            user.resetPasswordOTPHash = hashResetCode(email, otpCode);
            user.resetPasswordNonce = nonce;
            user.resetPasswordAttempts = 0;
            user.resetPasswordExpires = new Date(Date.now() + RESET_WINDOW_MS);
            await user.save({ validateBeforeSave: false });

            try {
                await sendPasswordResetEmail(user.email, otpCode, user.name);
            } catch (error) {
                await User.updateOne(
                    { _id: user._id, resetPasswordNonce: nonce },
                    {
                        $unset: {
                            resetPasswordOTPHash: '',
                            resetPasswordNonce: '',
                            resetPasswordExpires: '',
                        },
                        $set: { resetPasswordAttempts: 0 },
                    },
                );
                console.error(`[${req.id}] Password reset email delivery failed:`, error?.message || error);
            }
        }

        return res.status(200).json({ status: 'success', message: genericRecoveryMessage });
    } catch (error) {
        return next(error);
    }
});

router.post('/verify-code', verificationLimiter, async (req, res, next) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const code = typeof req.body?.code === 'string'
            ? req.body.code.trim()
            : String(req.body?.code || '').trim();
        if (!EMAIL_PATTERN.test(email) || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ status: 'error', message: 'Kod gecersiz veya suresi dolmus.' });
        }

        const user = await User.findOneAndUpdate(
            {
                email,
                isDeleted: { $ne: true },
                resetPasswordExpires: { $gt: new Date() },
                resetPasswordAttempts: { $lt: RESET_MAX_ATTEMPTS },
            },
            { $inc: { resetPasswordAttempts: 1 } },
            { new: true },
        ).select('+resetPasswordOTPHash +resetPasswordNonce +resetPasswordAttempts +resetPasswordExpires +tokenVersion');

        const submittedHash = hashResetCode(email, code);
        if (!user || !secureHexEqual(user.resetPasswordOTPHash, submittedHash)) {
            if (user && user.resetPasswordAttempts >= RESET_MAX_ATTEMPTS) {
                await User.updateOne(
                    { _id: user._id, resetPasswordNonce: user.resetPasswordNonce },
                    {
                        $unset: {
                            resetPasswordOTPHash: '',
                            resetPasswordNonce: '',
                            resetPasswordExpires: '',
                        },
                    },
                );
            }
            return res.status(400).json({ status: 'error', message: 'Kod gecersiz veya suresi dolmus.' });
        }

        const resetToken = jwt.sign(
            {
                id: user._id.toString(),
                nonce: user.resetPasswordNonce,
                purpose: 'reset-password',
                tokenVersion: Number(user.tokenVersion || 0),
            },
            getJwtSecret(),
            {
                algorithm: 'HS256',
                expiresIn: RESET_TOKEN_TTL,
                issuer: 'motovibe-api',
                audience: 'motovibe-password-reset',
            },
        );

        return res.status(200).json({
            status: 'success',
            message: 'Kod basariyla dogrulandi.',
            resetToken,
            data: { resetToken },
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/reset-password', verificationLimiter, async (req, res, next) => {
    try {
        const resetToken = typeof req.body?.resetToken === 'string' ? req.body.resetToken.trim() : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
        if (!resetToken) {
            return res.status(401).json({ status: 'error', message: 'Sifre yenileme oturumu gecersiz.' });
        }
        if (newPassword.length < 8 || newPassword.length > 128) {
            return res.status(422).json({ status: 'error', message: 'Yeni sifre 8-128 karakter arasinda olmalidir.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(resetToken, getJwtSecret(), {
                algorithms: ['HS256'],
                issuer: 'motovibe-api',
                audience: 'motovibe-password-reset',
            });
        } catch {
            return res.status(401).json({ status: 'error', message: 'Sifre yenileme oturumu gecersiz veya suresi dolmus.' });
        }

        if (
            decoded?.purpose !== 'reset-password' ||
            !mongoose.Types.ObjectId.isValid(decoded?.id) ||
            typeof decoded?.nonce !== 'string' ||
            !decoded.nonce
        ) {
            return res.status(401).json({ status: 'error', message: 'Sifre yenileme oturumu gecersiz.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        const decodedTokenVersion = Number(decoded.tokenVersion || 0);
        const result = await User.updateOne(
            {
                _id: decoded.id,
                isDeleted: { $ne: true },
                resetPasswordNonce: decoded.nonce,
                resetPasswordExpires: { $gt: new Date() },
                tokenVersion: decodedTokenVersion === 0
                    ? { $in: [0, null] }
                    : decodedTokenVersion,
            },
            {
                $set: { password: passwordHash, resetPasswordAttempts: 0 },
                $inc: { tokenVersion: 1 },
                $unset: {
                    resetPasswordOTPHash: '',
                    resetPasswordNonce: '',
                    resetPasswordExpires: '',
                    refreshSessions: '',
                },
            },
        );

        if (result.modifiedCount !== 1) {
            return res.status(401).json({ status: 'error', message: 'Sifre yenileme oturumu kullanilmis veya suresi dolmus.' });
        }

        disconnectUserSessions(decoded.id);

        return res.status(200).json({
            status: 'success',
            message: 'Sifreniz basariyla sifirlandi. Yeni sifrenizle giris yapabilirsiniz.',
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/refresh', refreshLimiter, async (req, res, next) => {
    try {
        const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
        if (!refreshToken || refreshToken.length > 1024) {
            return res.status(401).json({ status: 'error', message: 'Oturum yenileme anahtari gecersiz.' });
        }

        const oldHash = hashOpaqueToken(refreshToken);
        const familyId = getRefreshTokenFamilyId(refreshToken);
        if (!familyId) {
            return res.status(401).json({ status: 'error', message: 'Oturum yenileme anahtari gecersiz.' });
        }
        const { refreshToken: rotatedToken, session } = createRefreshSession({ familyId });
        const now = new Date();
        const user = await User.findOneAndUpdate(
            {
                isDeleted: { $ne: true },
                refreshSessions: {
                    $elemMatch: { tokenHash: oldHash, expiresAt: { $gt: now } },
                },
            },
            [{
                $set: {
                    refreshSessions: {
                        $slice: [
                            {
                                $concatArrays: [
                                    {
                                        $filter: {
                                            input: { $ifNull: ['$refreshSessions', []] },
                                            as: 'session',
                                            cond: { $ne: ['$$session.tokenHash', oldHash] },
                                        },
                                    },
                                    [session],
                                ],
                            },
                            -5,
                        ],
                    },
                },
            }],
            { returnDocument: 'after', updatePipeline: true },
        ).select('+tokenVersion');

        if (!user) {
            // A previously rotated token being presented again indicates token
            // theft or a replay race. Revoke the entire session family.
            await User.updateMany(
                { 'refreshSessions.familyId': familyId },
                { $pull: { refreshSessions: { familyId } } },
            );
            return res.status(401).json({ status: 'error', message: 'Oturum yenileme anahtari gecersiz veya suresi dolmus.' });
        }

        const accessToken = signAccessToken(user);
        return res.status(200).json({
            status: 'success',
            token: accessToken,
            refreshToken: rotatedToken,
            data: { token: accessToken, refreshToken: rotatedToken },
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/logout', async (req, res, next) => {
    try {
        const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
        if (refreshToken && refreshToken.length <= 1024) {
            const tokenHash = hashOpaqueToken(refreshToken);
            await User.updateOne(
                { 'refreshSessions.tokenHash': tokenHash },
                { $pull: { refreshSessions: { tokenHash } } },
            );
        }
        return res.status(204).send();
    } catch (error) {
        return next(error);
    }
});

router.get('/me', protect, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).lean();
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Kullanici bulunamadi.' });
        }
        return res.status(200).json({ status: 'success', data: { user } });
    } catch (error) {
        return next(error);
    }
});

export {
    hashResetCode,
    secureHexEqual,
};

export default router;
