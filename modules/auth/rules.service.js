import crypto from 'crypto';

import { getJwtSecret } from "../../config/env.js";

export const RESET_WINDOW_MS = 15 * 60 * 1000;

export const RESET_MAX_ATTEMPTS = 5;

export const RESET_TOKEN_TTL = '10m';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const hashResetCode = (email, code) => crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${email}:${code}`, 'utf8')
    .digest('hex');

export const secureHexEqual = (left, right) => {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const genericRecoveryMessage = 'Eger e-posta adresi sistemimizde kayitliysa 6 haneli dogrulama kodu gonderildi.';
