import { serviceResult } from '../../utils/serviceResult.js';
import { issueSessionTokens } from "../auth/service.js";

export const createSessionResult = async (user, statusCode) => {
    const { accessToken, refreshToken } = await issueSessionTokens(user);

    // Remove password from output
    user.password = undefined;
    user.tokenVersion = undefined;
    user.refreshSessions = undefined;
    user.resetPasswordOTPHash = undefined;
    user.resetPasswordNonce = undefined;
    user.resetPasswordAttempts = undefined;
    user.resetPasswordExpires = undefined;

    return serviceResult({
        status: 'success',
        token: accessToken,
        refreshToken,
        data: {
            token: accessToken,
            refreshToken,
            user
        }
    },statusCode);
};

export function isValidTurkishTaxIdentifier(rawValue) {
    const value = String(rawValue || '').trim();
    return /^\d{10}$/.test(value) || /^\d{11}$/.test(value);
}

export function parseFollowListPaging(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    return { page, limit, skip: (page - 1) * limit };
}

export const ALLOWED_ACCENT_COLORS = [
    '#E2FF3B', // Neon Lime (Default)
    '#CC0000', // Rosso Red (Ducati)
    '#0033CC', // Racing Blue (Yamaha)
    '#66FF00', // Ninja Green (Kawasaki)
    '#FF6600', // Ready Orange (KTM)
    '#E0E0E0', // Stealth Silver (Minimalist)
    '#D34599', // Magenta Rush (Vibe)
    '#F104BD', // Electric Pink (Pop)
    '#F3CB0C', // Gold Rush (Apex)
    '#0B9089', // Deep Teal (Ocean)
    '#8A0526', // Ruby Wine (Classic)
    '#F0028B', // Hot Neon (Street)
    '#91C7AF', // Sage Mint (Modern)
];

export const PRO_OFFERS = [
    {
        id: 'pro_monthly',
        period: 'monthly',
        price: 149.99,
        title: 'Aylik Plan',
        subtitle: 'Esnek baslangic, istedigin zaman degistir.',
        formattedPrice: '149.99 TL',
        isBestValue: false
    },
    {
        id: 'pro_yearly',
        period: 'yearly',
        price: 1199.99,
        title: 'Yillik Plan',
        subtitle: 'Apex suruculerinin en cok sectigi plan.',
        formattedPrice: '1199.99 TL',
        isBestValue: true
    },
    {
        id: 'pro_lifetime',
        period: 'lifetime',
        price: 3499.99,
        title: 'Lifetime',
        subtitle: 'Tek odeme ile kalici PRO erisimi.',
        formattedPrice: '3499.99 TL',
        isBestValue: false
    }
];
