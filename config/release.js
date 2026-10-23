import AppError from '../utils/appError.js';
import { isBusinessCheckoutEnabled } from "../modules/business/iyzicoCheckoutService.service.js";

const configured = (...names) => names.every(name => {
    const value = process.env[name]?.trim();
    return Boolean(value && !value.startsWith('replace_'));
});

export const getRuntimeCapabilities = () => {
    const sms = configured('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER') ||
        configured('NETGSM_USER', 'NETGSM_PASS', 'NETGSM_HEADER');
    return {
        emailPasswordReset: configured('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'),
        phoneOtp: sms,
        sosSms: sms,
        businessCheckout: isBusinessCheckoutEnabled() && (process.env.NODE_ENV !== 'production' ||
            process.env.IYZIPAY_URI === 'https://api.iyzipay.com'),
        shop: false, music: false, forum: false, vlogMap: false,
        council: false, stolen: false, ai: false, directCalls: false, messageReactions: false, categories: false, models3d: false
    };
};

export const disabledFeaturePrefixes = {
    shop: ['/api/products', '/api/orders', '/api/showcase', '/api/negotiations', '/api/users/cart'],
    music: ['/api/music', '/api/spotify', '/api/lastfm'],
    forum: ['/api/forum'], vlogMap: ['/api/vlogs'], council: ['/api/council'],
    stolen: ['/api/stolen-items'], ai: ['/api/ai'], directCalls: ['/api/calls'], categories: ['/api/categories'], models3d: ['/api/models']
};
export const disabledReleaseFeature = (req, res, next) => {
    const error = new AppError('Bu özellik bu sürümde kullanılamıyor.', 404);
    error.code = 'FEATURE_DISABLED';
    next(error);
};
