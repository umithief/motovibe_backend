import mongoose from 'mongoose';

export const BUSINESS_CATEGORIES = ['SERVICE', 'STORE', 'CAFE', 'RENTAL', 'INFLUENCER'];

export const BUSINESS_WEEKDAYS = new Set([
    'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'
]);

export const BUSINESS_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidBusinessCoordinates(value) {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude) &&
        longitude >= -180 && longitude <= 180 &&
        latitude >= -90 && latitude <= 90;
}

export function normalizeBusinessWorkingHours(value) {
    if (!Array.isArray(value)) {
        return { error: 'Çalışma saatleri dizi formatında olmalıdır.' };
    }
    if (value.length > 7) {
        return { error: 'En fazla 7 günlük çalışma saati tanımlanabilir.' };
    }
    const seen = new Set();
    const normalized = [];
    for (const raw of value) {
        const day = String(raw?.day || '').trim();
        const isClosed = raw?.isClosed === true;
        const open = String(raw?.open || '').trim();
        const close = String(raw?.close || '').trim();
        if (!BUSINESS_WEEKDAYS.has(day) || seen.has(day)) {
            return { error: 'Çalışma günü geçersiz veya yinelenmiş.' };
        }
        if (!isClosed) {
            if (!BUSINESS_TIME_PATTERN.test(open) || !BUSINESS_TIME_PATTERN.test(close)) {
                return { error: `${day} için çalışma saati HH:mm formatında olmalıdır.` };
            }
            const [openHour, openMinute] = open.split(':').map(Number);
            const [closeHour, closeMinute] = close.split(':').map(Number);
            if (openHour * 60 + openMinute >= closeHour * 60 + closeMinute) {
                return { error: `${day} kapanış saati açılıştan sonra olmalıdır.` };
            }
        }
        seen.add(day);
        normalized.push({
            day,
            open: isClosed ? (open || '09:00') : open,
            close: isClosed ? (close || '18:00') : close,
            isClosed
        });
    }
    return { value: normalized };
}

export function maskTaxIdentifier(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return null;
    return `${'*'.repeat(Math.max(value.length - 2, 0))}${value.slice(-2)}`;
}

export function normalizeBusinessServices(services) {
    if (!Array.isArray(services)) return [];
    return [...new Set(
        services
            .map((service) => String(service || '').trim())
            .filter((service) => service.length > 0 && service.length <= 60)
    )].slice(0, 40);
}

export function buildBusinessCatalogItemInput(payload, { preserveId = false } = {}) {
    if (!payload || typeof payload !== 'object') {
        return { error: 'Ürün bilgileri geçersiz.' };
    }

    const name = String(payload.name || '').trim();
    if (!name || name.length > 80) {
        return { error: 'Ürün adı 1 ile 80 karakter arasında olmalıdır.' };
    }

    const categoryRaw = String(payload.category || '').trim();
    if (categoryRaw.length > 40) {
        return { error: 'Kategori en fazla 40 karakter olabilir.' };
    }

    const price = Number(payload.price);
    if (!Number.isFinite(price) || price < 0) {
        return { error: 'Fiyat 0 veya daha büyük bir sayı olmalıdır.' };
    }

    let discountPrice;
    if (payload.discountPrice !== undefined && payload.discountPrice !== null && payload.discountPrice !== '') {
        const parsedDiscount = Number(payload.discountPrice);
        if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0 || parsedDiscount >= price) {
            return { error: 'İndirimli fiyat normal fiyattan küçük ve 0 veya daha büyük olmalıdır.' };
        }
        discountPrice = parsedDiscount;
    }

    const durationMin = Number(payload.durationMin ?? 60);
    if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 480 || durationMin % 15 !== 0) {
        return { error: 'Hizmet süresi 15-480 dakika arasında ve 15 dakikanın katı olmalıdır.' };
    }

    const apexBonusRaw = Number(payload.apexBonus ?? 0);
    if (!Number.isFinite(apexBonusRaw) || apexBonusRaw < 0 || !Number.isInteger(apexBonusRaw)) {
        return { error: 'Apex bonus 0 veya daha büyük tam sayı olmalıdır.' };
    }

    const stockRaw = Number(payload.stock ?? 0);
    if (!Number.isFinite(stockRaw) || stockRaw < 0 || !Number.isInteger(stockRaw)) {
        return { error: 'Stok 0 veya daha büyük tam sayı olmalıdır.' };
    }

    const imageUrl = String(payload.imageUrl || '').trim();
    if (imageUrl.length > 400) {
        return { error: 'Görsel adresi en fazla 400 karakter olabilir.' };
    }
    if (imageUrl) {
        const isMotoVibeUpload = imageUrl.startsWith('/api/uploads/');
        let isRemoteImage = false;
        try {
            const parsedUrl = new URL(imageUrl);
            isRemoteImage = parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:';
        } catch (_) {
            // Local MotoVibe media URLs are intentionally relative.
        }
        if (!isMotoVibeUpload && !isRemoteImage) {
            return { error: 'Görsel adresi https/http veya /api/uploads/ ile başlamalıdır.' };
        }
    }

    const description = String(payload.description || '').trim();
    if (description.length > 280) {
        return { error: 'Ürün açıklaması en fazla 280 karakter olabilir.' };
    }

    const item = {
        name,
        category: categoryRaw || 'Diger',
        price,
        discountPrice,
        durationMin,
        apexBonus: apexBonusRaw,
        stock: stockRaw,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true
    };

    if (preserveId && payload._id && mongoose.Types.ObjectId.isValid(String(payload._id))) {
        item._id = new mongoose.Types.ObjectId(String(payload._id));
    }

    return { value: item };
}

export function normalizeBusinessCatalogItems(items) {
    if (!Array.isArray(items)) return { error: 'Katalog listesi dizi formatında olmalıdır.' };
    if (items.length > 120) return { error: 'Katalog en fazla 120 ürün içerebilir.' };

    const normalized = [];
    for (let index = 0; index < items.length; index += 1) {
        const parsed = buildBusinessCatalogItemInput(items[index], { preserveId: true });
        if (parsed.error) {
            return { error: `Katalogdaki ${index + 1}. ürün: ${parsed.error}` };
        }
        normalized.push(parsed.value);
    }
    return { value: normalized };
}

export function sanitizeBusinessFlashOffers(rawOffers) {
    if (!Array.isArray(rawOffers)) return [];

    const now = Date.now();
    const sanitized = [];

    for (const raw of rawOffers.slice(0, 30)) {
        if (!raw || typeof raw !== 'object') continue;

        const offerId = String(raw.offerId || '').trim().slice(0, 64);
        if (!offerId) continue;

        const title = String(raw.title || '').trim().slice(0, 80);
        if (!title) continue;

        const description = String(raw.description || '').trim().slice(0, 220);
        const discountRateRaw = Number(raw.discountRate);
        const discountRate = Number.isFinite(discountRateRaw)
            ? Math.max(0, Math.min(95, Math.round(discountRateRaw)))
            : 0;

        const targetRadiusRaw = Number(raw.targetRadiusKm);
        const targetRadiusKm = Number.isFinite(targetRadiusRaw)
            ? Math.max(1, Math.min(300, Math.round(targetRadiusRaw)))
            : 20;

        const parsedValidUntil = new Date(raw.validUntil);
        const validUntil = Number.isNaN(parsedValidUntil.getTime())
            ? new Date(now + (60 * 60 * 1000))
            : parsedValidUntil;

        const parsedCreatedAt = new Date(raw.createdAt);
        const createdAt = Number.isNaN(parsedCreatedAt.getTime())
            ? new Date(now)
            : parsedCreatedAt;

        const isActive = raw.isActive !== false && validUntil.getTime() > now;

        sanitized.push({
            offerId,
            title,
            description: description || undefined,
            discountRate,
            targetRadiusKm,
            validUntil,
            isActive,
            createdAt
        });
    }

    sanitized.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sanitized.slice(0, 20);
}

export function businessProfileForPublic(rawProfile) {
    if (!rawProfile) return rawProfile;
    const profile = rawProfile.toObject ? rawProfile.toObject() : rawProfile;
    const {
        taxId,
        iyzicoSubMerchantKey,
        flashOffers,
        ...publicProfile
    } = profile;
    return {
        ...publicProfile,
        flashOffers: sanitizeBusinessFlashOffers(flashOffers || [])
            .filter((offer) => offer.isActive)
    };
}

export function buildBusinessFlashOfferInput(payload) {
    const title = String(payload?.title || '').trim();
    const description = String(payload?.description || '').trim();
    const discountRateRaw = Number(payload?.discountRate);
    const durationMinutesRaw = Number(payload?.durationMinutes);
    const targetRadiusRaw = Number(payload?.targetRadiusKm);

    if (!title) {
        return { error: 'Kampanya basligi zorunludur.' };
    }
    if (title.length > 80) {
        return { error: 'Kampanya basligi en fazla 80 karakter olabilir.' };
    }
    if (description.length > 220) {
        return { error: 'Kampanya aciklamasi en fazla 220 karakter olabilir.' };
    }
    if (!Number.isFinite(discountRateRaw) || discountRateRaw < 1 || discountRateRaw > 95) {
        return { error: 'Indirim orani 1 ile 95 arasinda olmalidir.' };
    }
    if (!Number.isFinite(durationMinutesRaw) || durationMinutesRaw < 10 || durationMinutesRaw > 1440) {
        return { error: 'Kampanya suresi 10 ile 1440 dakika arasinda olmalidir.' };
    }
    if (!Number.isFinite(targetRadiusRaw) || targetRadiusRaw < 1 || targetRadiusRaw > 300) {
        return { error: 'Hedef yaricapi 1 ile 300 km arasinda olmalidir.' };
    }

    const now = Date.now();
    const validUntil = new Date(now + Math.round(durationMinutesRaw) * 60 * 1000);

    return {
        value: {
            offerId: new mongoose.Types.ObjectId().toString(),
            title,
            description: description || undefined,
            discountRate: Math.round(discountRateRaw),
            targetRadiusKm: Math.round(targetRadiusRaw),
            validUntil,
            isActive: true,
            createdAt: new Date(now)
        }
    };
}

export function normalizeProfessionalStatusForResponse(user) {
    if (user?.userType !== 'PROFESSIONAL') {
        user.activeProfileMode = 'PERSONAL';
    } else if (!user.activeProfileMode) {
        user.activeProfileMode = 'PROFESSIONAL';
    }

    return user;
}

export function buildBusinessUserPayload(user) {
    return {
        _id: user._id,
        id: user.id || user._id,
        userType: user.userType,
        activeProfileMode: user.activeProfileMode || (user.userType === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'PERSONAL'),
        isPro: user.isPro,
        isVerified: user.isVerified,
        verificationStatus: user.verificationStatus,
        businessProfile: businessProfileForPublic(user.businessProfile)
    };
}
