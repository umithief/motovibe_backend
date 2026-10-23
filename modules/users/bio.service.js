
export const FREE_BIO_BLOCK_TYPES = [
    'TEXT',
    'BRAND_LOGO',
    'SOCIAL_LINK',
    'DIVIDER',
    'GARAGE_WIDGET'
];

export const PRO_BIO_BLOCK_TYPES = [
    'STAT',
    'SPOTIFY',
    'YOUTUBE_MUSIC',
    'TELEMETRY_HOLOGRAM',
    'EXHAUST_NOTE',
    'ROUTE_SHOWCASE',
    'ACHIEVEMENT_BADGE',
    'MAINTENANCE_CARD'
];

export const ALL_BIO_BLOCK_TYPES = [...FREE_BIO_BLOCK_TYPES, ...PRO_BIO_BLOCK_TYPES];

export const TYPE_NORMALIZATION_MAP = {
    text: 'TEXT',
    TEXT: 'TEXT',
    brandLogo: 'BRAND_LOGO',
    brand_logo: 'BRAND_LOGO',
    BRAND_LOGO: 'BRAND_LOGO',
    socialLink: 'SOCIAL_LINK',
    social_link: 'SOCIAL_LINK',
    SOCIAL_LINK: 'SOCIAL_LINK',
    divider: 'DIVIDER',
    DIVIDER: 'DIVIDER',
    garageWidget: 'GARAGE_WIDGET',
    garage_widget: 'GARAGE_WIDGET',
    GARAGE_WIDGET: 'GARAGE_WIDGET',
    stat: 'STAT',
    STAT: 'STAT',
    spotify: 'SPOTIFY',
    SPOTIFY: 'SPOTIFY',
    youtubeMusic: 'YOUTUBE_MUSIC',
    youtube_music: 'YOUTUBE_MUSIC',
    YOUTUBE_MUSIC: 'YOUTUBE_MUSIC',
    telemetryHologram: 'TELEMETRY_HOLOGRAM',
    telemetry_hologram: 'TELEMETRY_HOLOGRAM',
    TELEMETRY_HOLOGRAM: 'TELEMETRY_HOLOGRAM',
    exhaustNote: 'EXHAUST_NOTE',
    exhaust_note: 'EXHAUST_NOTE',
    EXHAUST_NOTE: 'EXHAUST_NOTE',
    routeShowcase: 'ROUTE_SHOWCASE',
    route_showcase: 'ROUTE_SHOWCASE',
    ROUTE_SHOWCASE: 'ROUTE_SHOWCASE',
    achievementBadge: 'ACHIEVEMENT_BADGE',
    achievement_badge: 'ACHIEVEMENT_BADGE',
    ACHIEVEMENT_BADGE: 'ACHIEVEMENT_BADGE',
    maintenanceCard: 'MAINTENANCE_CARD',
    maintenance_card: 'MAINTENANCE_CARD',
    MAINTENANCE_CARD: 'MAINTENANCE_CARD'
};

export function sanitizeString(str, maxLen = 200, fallback = '') {
    if (typeof str !== 'string') return fallback;
    const clean = str.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    return clean.slice(0, maxLen);
}

export function sanitizeUrl(urlStr, maxLen = 400) {
    if (!urlStr || typeof urlStr !== 'string') return '';
    const clean = urlStr.trim();
    if (clean.length > maxLen) return '';
    if (clean.startsWith('/api/uploads/')) return clean;
    try {
        const parsed = new URL(clean);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return clean;
        }
    } catch (_) {}
    return '';
}

export function validateAndSanitizeBioBlocks(rawBlocks, user, options = {}) {
    if (!Array.isArray(rawBlocks)) {
        return { error: 'Blok listesi dizi formatında olmalıdır.' };
    }

    const isPro = Boolean(user.isPro && (!user.proExpiryDate || user.proExpiryDate > new Date()));
    const maxBlocks = isPro ? 20 : 5;

    if (rawBlocks.length > maxBlocks) {
        return {
            error: `Maksimum blok sayısını (${maxBlocks}) aştınız. Sınırsız özellikler ve 20 blok için MotoVibe PRO'ya geçin.`,
            status: 403
        };
    }

    const userGarageIds = new Set(
        (Array.isArray(user.garage) ? user.garage : []).map(b => (b._id || b.id || '').toString())
    );
    const userUnlockedAchIds = new Set(
        (Array.isArray(user.unlockedAchievements) ? user.unlockedAchievements : []).map(id => id.toString())
    );
    // Studio picks from getMyRoutes (author) OR saved favorites — allow both.
    const userRouteIds = new Set([
        ...(Array.isArray(user.savedRoutes) ? user.savedRoutes : []).map(id => id.toString()),
        ...(Array.isArray(options.authoredRouteIds) ? options.authoredRouteIds : []).map(id => id.toString()),
        ...(Array.isArray(user.authoredRouteIds) ? user.authoredRouteIds : []).map(id => id.toString())
    ]);

    // Union of Mod Shop + BioRenderer + legacy aliases (diamond/noise)
    const validBgTypes = [
        'transparent', 'surface', 'elevated', 'dark metal', 'solid', 'glass',
        'gradient', 'carbon', 'asphalt', 'circuit', 'brushed', 'mesh',
        'diamond', 'noise'
    ];
    const validEffects = ['none', 'outline', 'shadow', 'glow', 'neon', 'glitch', 'retro', 'chrome', 'fire', 'ice', 'emboss'];

    const sanitizedBlocks = [];

    for (let i = 0; i < rawBlocks.length; i += 1) {
        const raw = rawBlocks[i];
        if (!raw || typeof raw !== 'object') {
            return { error: `${i + 1}. blok geçersiz nesne formatında.` };
        }

        const rawType = String(raw.type || '').trim();
        const canonicalType = TYPE_NORMALIZATION_MAP[rawType] || 'TEXT';

        if (!ALL_BIO_BLOCK_TYPES.includes(canonicalType)) {
            return { error: `${i + 1}. blokta bilinmeyen blok tipi: ${rawType}` };
        }

        if (PRO_BIO_BLOCK_TYPES.includes(canonicalType) && !isPro) {
            return {
                error: 'İstatistik, Spotify, YouTube Music, Telemetri, Egzoz, Rota, Başarım Rozeti ve Bakım Kartı blokları sadece MotoVibe PRO abonelerine özeldir.',
                status: 403,
                requiresPro: true
            };
        }

        const blockId = sanitizeString(raw.id, 64, `block_${Date.now()}_${i}`);
        const order = Number.isInteger(Number(raw.order)) ? Math.max(0, Number(raw.order)) : i;

        // Sanitize Style — strictly preserving all MotoVibe Studio FE contract fields
        const rawStyle = (raw.style && typeof raw.style === 'object') ? raw.style : {};

        const gridHeightVal = (rawStyle.gridHeight !== undefined && rawStyle.gridHeight !== null)
            ? (Number.isFinite(Number(rawStyle.gridHeight)) ? Math.max(1, Math.min(24000, Math.round(Number(rawStyle.gridHeight)))) : null)
            : (rawStyle.gridH !== undefined && rawStyle.gridH !== null && Number.isFinite(Number(rawStyle.gridH))
                ? Math.max(1, Math.min(24000, Math.round(Number(rawStyle.gridH))))
                : null);

        const sanitizedStyle = {
            color: sanitizeString(rawStyle.color, 32, '#FFFFFF'),
            font: sanitizeString(rawStyle.font, 32, 'Street'),
            align: ['left', 'center', 'right'].includes(rawStyle.align) ? rawStyle.align : 'left',
            bgType: validBgTypes.includes(rawStyle.bgType) ? rawStyle.bgType : 'transparent',
            animate: rawStyle.animate !== undefined ? Boolean(rawStyle.animate) : true,
            effect: validEffects.includes(rawStyle.effect) ? rawStyle.effect : 'none',
            opacity: Number.isFinite(Number(rawStyle.opacity)) ? Math.max(0.0, Math.min(1.0, Number(rawStyle.opacity))) : 1.0,
            borderWidth: Number.isFinite(Number(rawStyle.borderWidth)) ? Math.max(0.0, Math.min(10.0, Number(rawStyle.borderWidth))) : 1.0,
            borderRadius: Number.isFinite(Number(rawStyle.borderRadius)) ? Math.max(0.0, Math.min(50.0, Number(rawStyle.borderRadius))) : 20.0,
            shadowGlow: Number.isFinite(Number(rawStyle.shadowGlow)) ? Math.max(0.0, Math.min(50.0, Number(rawStyle.shadowGlow))) : 0.0,
            boxWidth: Number.isFinite(Number(rawStyle.boxWidth)) ? Math.max(25.0, Math.min(100.0, Number(rawStyle.boxWidth))) : 100.0,
            boxHeight: Number.isFinite(Number(rawStyle.boxHeight)) ? Math.max(0.0, Math.min(100.0, Number(rawStyle.boxHeight))) : 14.0,
            textScale: Number.isFinite(Number(rawStyle.textScale)) ? Math.max(0.5, Math.min(3.0, Number(rawStyle.textScale))) : 1.0,
            letterSpacing: Number.isFinite(Number(rawStyle.letterSpacing)) ? Math.max(-5.0, Math.min(20.0, Number(rawStyle.letterSpacing))) : 0.0,
            lineHeight: Number.isFinite(Number(rawStyle.lineHeight)) ? Math.max(0.5, Math.min(3.0, Number(rawStyle.lineHeight))) : 1.2,
            rotation: Number.isFinite(Number(rawStyle.rotation)) ? Math.max(-360.0, Math.min(360.0, Number(rawStyle.rotation))) : 0.0,
            gridX: (rawStyle.gridX !== undefined && rawStyle.gridX !== null && Number.isFinite(Number(rawStyle.gridX)))
                ? Math.max(0, Math.min(1000, Math.round(Number(rawStyle.gridX))))
                : null,
            gridY: (rawStyle.gridY !== undefined && rawStyle.gridY !== null && Number.isFinite(Number(rawStyle.gridY)))
                ? Math.max(0, Math.min(24000, Math.round(Number(rawStyle.gridY))))
                : null,
            gridHeight: gridHeightVal,
            isLocked: Boolean(rawStyle.isLocked),
            isPinned: Boolean(rawStyle.isPinned),
            isVisible: rawStyle.isVisible !== undefined ? Boolean(rawStyle.isVisible) : true
        };

        // Sanitize Data
        const rawData = (raw.data && typeof raw.data === 'object') ? raw.data : {};
        let sanitizedData = {};

        switch (canonicalType) {
            case 'TEXT':
                sanitizedData = {
                    text: sanitizeString(rawData.text, 500),
                    isNeon: Boolean(rawData.isNeon),
                    size: ['small', 'medium', 'large', 'huge'].includes(rawData.size) ? rawData.size : 'medium'
                };
                break;
            case 'BRAND_LOGO':
                sanitizedData = {
                    brandName: sanitizeString(rawData.brandName || rawData.brand, 50, 'Ducati'),
                    size: Number.isFinite(Number(rawData.size)) ? Math.max(20, Math.min(200, Number(rawData.size))) : 60,
                    logoUrl: sanitizeUrl(rawData.logoUrl)
                };
                break;
            case 'SOCIAL_LINK':
                sanitizedData = {
                    platform: sanitizeString(rawData.platform, 30, 'Instagram'),
                    url: sanitizeUrl(rawData.url),
                    label: sanitizeString(rawData.label, 40, 'Takip et'),
                    handle: sanitizeString(rawData.handle, 60, '@rider')
                };
                break;
            case 'DIVIDER':
                sanitizedData = {
                    glowColor: sanitizeString(rawData.glowColor, 32, '#D4AF37'),
                    variant: sanitizeString(rawData.variant, 30, 'road')
                };
                break;
            case 'GARAGE_WIDGET': {
                const rawBikeId = sanitizeString(rawData.bikeId, 64);
                const bikeOwned = !rawBikeId || userGarageIds.has(rawBikeId);
                sanitizedData = {
                    bikeId: bikeOwned ? rawBikeId : '',
                    customTitle: sanitizeString(rawData.customTitle, 60)
                };
                break;
            }
            case 'STAT':
                sanitizedData = {
                    label: sanitizeString(rawData.label, 40, 'Top Speed'),
                    value: sanitizeString(rawData.value, 30, '299'),
                    unit: sanitizeString(rawData.unit, 20, 'km/h'),
                    progress: Number.isFinite(Number(rawData.progress)) ? Math.max(0, Math.min(1, Number(rawData.progress))) : 0.0
                };
                break;
            case 'SPOTIFY': {
                const spTrack = sanitizeUrl(rawData.trackUrl);
                const isValidSp = !spTrack || /^https:\/\/(open\.spotify\.com|spotify\.link)\/.+$/.test(spTrack);
                sanitizedData = {
                    trackUrl: isValidSp ? spTrack : '',
                    trackName: sanitizeString(rawData.trackName, 100),
                    artistName: sanitizeString(rawData.artistName, 100),
                    coverUrl: sanitizeUrl(rawData.coverUrl),
                    isPlaying: Boolean(rawData.isPlaying)
                };
                break;
            }
            case 'YOUTUBE_MUSIC': {
                const ytTrack = sanitizeUrl(rawData.trackUrl);
                const isValidYt = !ytTrack || /^https:\/\/(music\.youtube\.com|youtu\.be|www\.youtube\.com)\/.+$/.test(ytTrack);
                sanitizedData = {
                    trackUrl: isValidYt ? ytTrack : '',
                    trackName: sanitizeString(rawData.trackName, 100),
                    artistName: sanitizeString(rawData.artistName, 100),
                    lastfmUsername: sanitizeString(rawData.lastfmUsername, 60),
                    coverUrl: sanitizeUrl(rawData.coverUrl),
                    isPlaying: Boolean(rawData.isPlaying)
                };
                break;
            }
            case 'TELEMETRY_HOLOGRAM':
                sanitizedData = {
                    layout: sanitizeString(rawData.layout, 30, 'radar'),
                    title: sanitizeString(rawData.title, 60, 'TOP SPEED'),
                    primaryLabel: sanitizeString(rawData.primaryLabel, 40, 'TOP SPEED'),
                    primaryValue: sanitizeString(rawData.primaryValue, 40),
                    primaryUnit: sanitizeString(rawData.primaryUnit, 20, 'KM/H'),
                    secondaryLabel: sanitizeString(rawData.secondaryLabel, 40, 'KM TOPLAM'),
                    secondaryValue: sanitizeString(rawData.secondaryValue, 40),
                    secondaryUnit: sanitizeString(rawData.secondaryUnit, 20, 'KM')
                };
                break;
            case 'EXHAUST_NOTE': {
                const exAudio = sanitizeUrl(rawData.audioUrl);
                // audio must be from our CDN or standard format
                const isValidAudio = !exAudio || /\.(mp3|wav|aac|ogg)$/i.test(exAudio) || exAudio.startsWith('/api/uploads/');
                sanitizedData = {
                    exhaustName: sanitizeString(rawData.exhaustName, 60, 'Akrapovic Titanium'),
                    audioUrl: isValidAudio ? exAudio : '',
                    isPlaying: Boolean(rawData.isPlaying)
                };
                break;
            }
            case 'ROUTE_SHOWCASE': {
                const rawRouteId = sanitizeString(rawData.routeId, 64);
                const routeOwned = !rawRouteId || userRouteIds.has(rawRouteId);
                sanitizedData = {
                    routeId: routeOwned ? rawRouteId : '',
                    title: sanitizeString(rawData.title, 80, 'Favori Rota'),
                    distance: sanitizeString(rawData.distance, 30, '42 km'),
                    location: sanitizeString(rawData.location, 60, 'İstanbul'),
                    difficulty: sanitizeString(rawData.difficulty, 30, 'Akıcı'),
                    highlight: sanitizeString(rawData.highlight, 200),
                    imageUrl: sanitizeUrl(rawData.imageUrl),
                    coordinates: Array.isArray(rawData.coordinates) ? rawData.coordinates.slice(0, 100) : []
                };
                break;
            }
            case 'ACHIEVEMENT_BADGE': {
                const rawAchId = sanitizeString(rawData.achievementId, 64);
                const achUnlocked = !rawAchId || userUnlockedAchIds.has(rawAchId);
                sanitizedData = {
                    achievementId: achUnlocked ? rawAchId : '',
                    title: sanitizeString(rawData.title, 80, 'MotoVibe Başarımı'),
                    subtitle: sanitizeString(rawData.subtitle, 140),
                    metric: sanitizeString(rawData.metric, 40),
                    rank: sanitizeString(rawData.rank, 30, 'Carbon')
                };
                break;
            }
            case 'MAINTENANCE_CARD':
                sanitizedData = {
                    maintenanceType: sanitizeString(rawData.maintenanceType, 40, 'GENEL BAKIM'),
                    title: sanitizeString(rawData.title, 80, 'Bakım Takibi'),
                    nextService: sanitizeString(rawData.nextService, 40, '1.200 km sonra'),
                    odometer: sanitizeString(rawData.odometer, 40, '18.400 km'),
                    note: sanitizeString(rawData.note, 200),
                    progress: Number.isFinite(Number(rawData.progress)) ? Math.max(0, Math.min(1, Number(rawData.progress))) : 0.72,
                    isOverdue: Boolean(rawData.isOverdue)
                };
                break;
            default:
                sanitizedData = rawData;
                break;
        }

        sanitizedBlocks.push({
            id: blockId,
            type: canonicalType,
            order,
            style: sanitizedStyle,
            data: sanitizedData
        });
    }

    return { value: sanitizedBlocks };
}
