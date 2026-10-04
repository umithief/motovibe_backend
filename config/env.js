const MIN_JWT_SECRET_LENGTH = 32;

export const getRequiredEnv = (name) => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} ortam degiskeni zorunludur.`);
    }
    return value;
};

export const getJwtSecret = () => {
    const secret = getRequiredEnv('JWT_SECRET');
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
        throw new Error(`JWT_SECRET en az ${MIN_JWT_SECRET_LENGTH} karakter olmalidir.`);
    }
    return secret;
};

export const getMongoUri = () => getRequiredEnv('MONGO_URI');

export const getMapboxDirectionsAccessToken = () => (
    process.env.MAPBOX_DIRECTIONS_ACCESS_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    ''
).trim();

export const getBodyLimit = () => process.env.BODY_LIMIT?.trim() || '1mb';

export const getAllowedOrigins = () => {
    const configured = process.env.CORS_ORIGINS?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (configured?.length) return configured;

    // Native mobile clients do not send a browser Origin header. In production,
    // an empty allowlist therefore keeps Flutter/Capacitor API traffic working
    // while denying every browser origin until CORS_ORIGINS is configured.
    return process.env.NODE_ENV === 'production' ? [] : ['*'];
};

export const validateRuntimeEnv = () => {
    getMongoUri();
    getJwtSecret();

    const isProd = process.env.NODE_ENV === 'production';
    const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    const hasTwilio = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
    const hasNetgsm = Boolean(process.env.NETGSM_USER && process.env.NETGSM_PASS);

    if (isProd) {
        const allowedOrigins = getAllowedOrigins();
        if (allowedOrigins.includes('*')) {
            throw new Error('Production ortaminda CORS_ORIGINS * icermemelidir.');
        }
        console.log('[RuntimeEnv] 🔒 Canlı (Production) Modu Aktif.');
        if (allowedOrigins.length === 0) {
            console.warn('[RuntimeEnv] ⚠️ CORS_ORIGINS tanımlı değil. Native istemciler kabul edilecek, tarayıcı origin istekleri reddedilecek.');
        }
        if (!hasSmtp) {
            console.warn('[RuntimeEnv] ⚠️ [PROD UYARI] SMTP_HOST, SMTP_USER veya SMTP_PASS tanımlanmamış. Şifre sıfırlama e-postaları gönderilemeyecek.');
        } else {
            console.log('[RuntimeEnv] ✉️ SMTP e-posta servisi hazır.');
        }

        if (!hasTwilio && !hasNetgsm) {
            console.warn('[RuntimeEnv] ⚠️ [PROD UYARI] TWILIO veya NETGSM bilgileri tanımlanmamış. Telefon OTP ve SOS SMS bildirimleri radar/soket modunda çalışacak.');
        } else {
            console.log(`[RuntimeEnv] 📱 SMS sağlayıcısı hazır (${hasTwilio ? 'Twilio' : 'Netgsm'}).`);
        }
    } else {
        console.log('[RuntimeEnv] 🛠️ Geliştirme (Development) Modu Aktif.');
    }
};
