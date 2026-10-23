import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';

import { raiseHttpError } from '../../utils/httpError.js';


import crypto from 'crypto';

import bcrypt from 'bcryptjs';

import jwt from 'jsonwebtoken';

import mongoose from 'mongoose';

import User from "../users/model.js";

import { getJwtSecret } from "../../config/env.js";

import { sendPasswordResetEmail } from "../notifications/email.service.js";

import { getRuntimeCapabilities } from "../../config/release.js";

import {
    createRefreshSession,
    getRefreshTokenFamilyId,
    hashOpaqueToken,
    signAccessToken,
} from "./service.js";

import { disconnectUserSessions } from "../../socket.js";



import { RESET_WINDOW_MS, RESET_MAX_ATTEMPTS, RESET_TOKEN_TTL, EMAIL_PATTERN, normalizeEmail, hashResetCode, secureHexEqual, genericRecoveryMessage } from './rules.service.js';

export const postForgotPassword=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        if (!getRuntimeCapabilities().emailPasswordReset) {
            return raiseHttpError({ status: 'error', message: 'E-posta servisi kapalı. Destek ekibiyle iletişime geç.' },503);
        }
        const email = normalizeEmail(input.body?.email);
        if (!EMAIL_PATTERN.test(email) || email.length > 254) {
            return raiseHttpError({ status: 'error', message: 'Gecerli bir e-posta adresi girin.' },422);
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
                console.error(`[${input.id}] Password reset email delivery failed:`, error?.message || error);
            }
        }

        return respond({ status: 'success', message: genericRecoveryMessage },200);
    } catch (error) {
        return throwError(error);
    }

    return response;
};

export const postVerifyCode=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const email = normalizeEmail(input.body?.email);
        const code = typeof input.body?.code === 'string'
            ? input.body.code.trim()
            : String(input.body?.code || '').trim();
        if (!EMAIL_PATTERN.test(email) || !/^\d{6}$/.test(code)) {
            return raiseHttpError({ status: 'error', message: 'Kod gecersiz veya suresi dolmus.' },400);
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
            return raiseHttpError({ status: 'error', message: 'Kod gecersiz veya suresi dolmus.' },400);
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

        return respond({
            status: 'success',
            message: 'Kod basariyla dogrulandi.',
            resetToken,
            data: { resetToken },
        },200);
    } catch (error) {
        return throwError(error);
    }

    return response;
};

export const postResetPassword=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const resetToken = typeof input.body?.resetToken === 'string' ? input.body.resetToken.trim() : '';
        const newPassword = typeof input.body?.newPassword === 'string' ? input.body.newPassword : '';
        if (!resetToken) {
            return raiseHttpError({ status: 'error', message: 'Sifre yenileme oturumu gecersiz.' },401);
        }
        if (newPassword.length < 8 || newPassword.length > 128) {
            return raiseHttpError({ status: 'error', message: 'Yeni sifre 8-128 karakter arasinda olmalidir.' },422);
        }

        let decoded;
        try {
            decoded = jwt.verify(resetToken, getJwtSecret(), {
                algorithms: ['HS256'],
                issuer: 'motovibe-api',
                audience: 'motovibe-password-reset',
            });
        } catch {
            return raiseHttpError({ status: 'error', message: 'Sifre yenileme oturumu gecersiz veya suresi dolmus.' },401);
        }

        if (
            decoded?.purpose !== 'reset-password' ||
            !mongoose.Types.ObjectId.isValid(decoded?.id) ||
            typeof decoded?.nonce !== 'string' ||
            !decoded.nonce
        ) {
            return raiseHttpError({ status: 'error', message: 'Sifre yenileme oturumu gecersiz.' },401);
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
            return raiseHttpError({ status: 'error', message: 'Sifre yenileme oturumu kullanilmis veya suresi dolmus.' },401);
        }

        disconnectUserSessions(decoded.id);

        return respond({
            status: 'success',
            message: 'Sifreniz basariyla sifirlandi. Yeni sifrenizle giris yapabilirsiniz.',
        },200);
    } catch (error) {
        return throwError(error);
    }

    return response;
};

export const postRefresh=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const refreshToken = typeof input.body?.refreshToken === 'string' ? input.body.refreshToken.trim() : '';
        if (!refreshToken || refreshToken.length > 1024) {
            return raiseHttpError({ status: 'error', message: 'Oturum yenileme anahtari gecersiz.' },401);
        }

        const oldHash = hashOpaqueToken(refreshToken);
        const familyId = getRefreshTokenFamilyId(refreshToken);
        if (!familyId) {
            return raiseHttpError({ status: 'error', message: 'Oturum yenileme anahtari gecersiz.' },401);
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
            return raiseHttpError({ status: 'error', message: 'Oturum yenileme anahtari gecersiz veya suresi dolmus.' },401);
        }

        const accessToken = signAccessToken(user);
        return respond({
            status: 'success',
            token: accessToken,
            refreshToken: rotatedToken,
            data: { token: accessToken, refreshToken: rotatedToken },
        },200);
    } catch (error) {
        return throwError(error);
    }

    return response;
};

export const postLogout=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const refreshToken = typeof input.body?.refreshToken === 'string' ? input.body.refreshToken.trim() : '';
        if (refreshToken && refreshToken.length <= 1024) {
            const tokenHash = hashOpaqueToken(refreshToken);
            await User.updateOne(
                { 'refreshSessions.tokenHash': tokenHash },
                { $pull: { refreshSessions: { tokenHash } } },
            );
        }
        return respond(undefined,204);
    } catch (error) {
        return throwError(error);
    }

    return response;
};

export const getMe=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const user = await User.findById(input.user.id).lean();
        if (!user) {
            return raiseHttpError({ status: 'error', message: 'Kullanici bulunamadi.' },404);
        }
        return respond({ status: 'success', data: { user } },200);
    } catch (error) {
        return throwError(error);
    }

    return response;
};
