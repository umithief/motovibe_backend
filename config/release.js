import { isBusinessCheckoutEnabled } from '../services/iyzicoCheckoutService.js';

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
        council: false, stolen: false, ai: false, directCalls: false
    };
};

export const disabledReleaseFeature = (req, res) => res.status(404).json({
    status: 'error', code: 'FEATURE_DISABLED', message: 'Bu özellik bu sürümde kullanılamıyor.'
});
