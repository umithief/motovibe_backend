import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { getJwtSecret } from '../config/env.js';

const MAX_REFRESH_SESSIONS = 5;

const getAccessTokenTtl = () => process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const getRefreshTokenTtlMs = () => {
    const configured = Number(process.env.JWT_REFRESH_TTL_MS);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : 30 * 24 * 60 * 60 * 1000;
};

export const hashOpaqueToken = (token) => crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');

export const signAccessToken = (user) => jwt.sign(
    {
        id: user._id.toString(),
        tokenVersion: Number(user.tokenVersion || 0),
    },
    getJwtSecret(),
    {
        algorithm: 'HS256',
        expiresIn: getAccessTokenTtl(),
        issuer: 'motovibe-api',
        audience: 'motovibe-app',
    },
);

export const verifyAccessToken = (token) => {
    const decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
        issuer: 'motovibe-api',
        audience: 'motovibe-app',
    });
    if (!Number.isInteger(decoded?.exp)) {
        throw new jwt.JsonWebTokenError('Access token is missing exp.');
    }
    return decoded;
};

const REFRESH_FAMILY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getRefreshTokenFamilyId = (token) => {
    if (typeof token !== 'string') return null;
    const separator = token.indexOf('.');
    if (separator <= 0) return null;
    const familyId = token.slice(0, separator);
    return REFRESH_FAMILY_PATTERN.test(familyId) ? familyId : null;
};

export const createRefreshSession = ({ familyId = crypto.randomUUID() } = {}) => {
    if (!REFRESH_FAMILY_PATTERN.test(familyId)) {
        throw new TypeError('Invalid refresh-token family id.');
    }
    const refreshToken = `${familyId}.${crypto.randomBytes(48).toString('base64url')}`;
    const now = new Date();
    return {
        refreshToken,
        session: {
            familyId,
            tokenHash: hashOpaqueToken(refreshToken),
            createdAt: now,
            expiresAt: new Date(now.getTime() + getRefreshTokenTtlMs()),
        },
    };
};

export const appendRefreshSession = (user, session) => {
    const now = Date.now();
    const activeSessions = (user.refreshSessions || [])
        .filter((item) => item?.expiresAt && new Date(item.expiresAt).getTime() > now)
        .slice(-(MAX_REFRESH_SESSIONS - 1));
    user.refreshSessions = [...activeSessions, session];
};

export const issueSessionTokens = async (user) => {
    const { refreshToken, session } = createRefreshSession();
    const result = await user.constructor.updateOne(
        { _id: user._id, isDeleted: { $ne: true } },
        {
            $push: {
                refreshSessions: {
                    $each: [session],
                    $slice: -MAX_REFRESH_SESSIONS,
                },
            },
        },
    );
    if (result.matchedCount !== 1) {
        throw new Error('Cannot issue a session for a missing or deleted user.');
    }
    return {
        accessToken: signAccessToken(user),
        refreshToken,
    };
};

export const refreshTokenExpiresAt = (from = Date.now()) => (
    new Date(Number(from) + getRefreshTokenTtlMs())
);
