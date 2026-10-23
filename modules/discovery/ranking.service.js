const normalizeSignal = (value) => String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR');

const signalsMatch = (left, right) => {
    if (left === right) return true;
    if ((left.length >= 3 && right.includes(left)) ||
        (right.length >= 3 && left.includes(right))) {
        return true;
    }
    const leftTokens = left.split(/[\s/,_-]+/u).filter(token => token.length >= 2);
    const rightTokens = new Set(
        right.split(/[\s/,_-]+/u).filter(token => token.length >= 2)
    );
    return leftTokens.some(token => rightTokens.has(token));
};

const stableHash = (value) => {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

export const stableJitter = (value) =>
    0.8 + (stableHash(value) / 0xffffffff) * 0.4;

export const buildViewerContext = (currentUser) => ({
    activeBikeModel: currentUser?.primaryBike || currentUser?.bikeModel || null,
    interests: (currentUser?.interestVector || [])
        .map(normalizeSignal)
        .filter(Boolean)
});

export const canonicalizeCategory = (rawCategory) => {
    const norm = normalizeSignal(rawCategory);
    if (!norm || ['for_you', 'foryou', 'sizin için', 'sizin_icin', 'all', 'genel'].includes(norm)) {
        return 'for_you';
    }
    if (['trend', 'trending'].includes(norm)) return 'trend';
    if (['videolar', 'video', 'vlog', 'reels', 'reel', 'videos'].includes(norm)) return 'videos';
    if (['rotalar', 'rota', 'routes', 'route'].includes(norm)) return 'routes';
    if (['takip edilenler', 'takip', 'following', 'followed', 'takip_edilenler'].includes(norm)) return 'following';
    return norm;
};

export const buildDiscoveryCacheKey = (
    userId,
    { blockedUsers = [], viewerContext = {}, category = '' } = {}
) => {
    const canonicalCat = canonicalizeCategory(category);
    const normCategory = canonicalCat === 'for_you' ? '' : canonicalCat;
    if (!userId && !normCategory) return 'feed:discover:global';

    const interests = (viewerContext.interests || [])
        .map(normalizeSignal)
        .filter(Boolean)
        .sort();
    const blocked = blockedUsers.map(id => String(id)).sort();
    const contextSignals = [
        normalizeSignal(viewerContext.activeBikeModel),
        ...interests,
        ...blocked,
        normCategory
    ].filter(Boolean);
    const fingerprint = stableHash(contextSignals.join('|')).toString(16);
    return `feed:discover:${userId || 'anon'}:${normCategory ? `${normCategory}:` : ''}${fingerprint}`;
};

export const rankDiscoveryItems = (items, rankingSeed = 'global') =>
    [...items].sort((a, b) => {
        const scoreA = a.score * stableJitter(`${rankingSeed}:${a.id}`);
        const scoreB = b.score * stableJitter(`${rankingSeed}:${b.id}`);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return String(a.id).localeCompare(String(b.id));
    });

// --- Helper: Node.js VibeScore Calculator (For updates) ---
export const calculateVibeScore = (
    item,
    type = 'post',
    viewerContext = {},
    config = null,
    rankingSeed = 'global'
) => {
    // defaults mapped safely to prevent NaN issues on partial updates
    const w = {
        like: config?.weights?.like ?? 10,
        comment: config?.weights?.comment ?? 30,
        share: config?.weights?.share ?? 50,
        save: config?.weights?.save ?? 60
    };

    const m = {
        telemetry: config?.multipliers?.telemetry ?? 1.5,
        affinity: config?.affinity ?? 1.3, // fallback if multipliers.affinity is missing
        pro: config?.multipliers?.pro ?? 1.2
    };
    if (config?.multipliers?.affinity !== undefined) m.affinity = config.multipliers.affinity;

    const decay = {
        enabled: config?.timeDecay?.enabled ?? true,
        factor: config?.timeDecay?.factor ?? 1.8,
        maxAgeDays: config?.timeDecay?.maxAgeDays ?? 30
    };

    let score = 0;

    // 1. Engagement Score based on Type
    if (type === 'post') {
        const likes = item.likeCount || (item.likes ? item.likes.length : 0);
        const comments = item.commentCount || (item.comments ? item.comments.length : 0);
        const shares = item.shareCount || 0;
        const saves = item.saveCount || (item.saves ? item.saves.length : 0);
        score = (likes * w.like) + (comments * w.comment) + (shares * w.share) + (saves * w.save);
    } else if (type === 'reel') {
        const likes = item.likes || 0;
        const comments = item.commentCount || item.comments || 0;
        const shares = item.shareCount || 0;
        const saves = item.saves || 0;
        const views = item.views || 0;

        // Exact same logic with added views bonus
        score = (likes * w.like) + (comments * w.comment) + (shares * w.share) + (saves * w.save) + (views / 5);
    } else if (type === 'route') {
        const riders = item.riderCount || 0;
        const rating = item.rating || 0;
        const reviews = (item.reviews || []).length;
        score = (riders * 2) + (rating * 15) + (reviews * w.comment);
    }


    // Give base score if none found to ensure new items have a chance
    if (score === 0) {
        const itemId = item?._id || item?.id || item?.createdAt || 'new-item';
        score = 5 + ((stableJitter(`${rankingSeed}:${type}:${itemId}`) - 0.8) / 0.4) * 5;
    }

    // 2. Uniform Multipliers for both

    // Telemetry & Route Scoring Parameters
    const tc = config?.telemetryConfig || {};
    const leanAngleMultiplier = tc.leanAngleMultiplier ?? 1.4;
    const speedQualityBonus = tc.speedQualityBonus ?? 1.3;
    const minLeanAngleThreshold = tc.minLeanAngleThreshold ?? 35;
    const elevationDifficultyWeight = tc.elevationDifficultyWeight ?? 1.25;
    const verifiedRouteBoost = tc.verifiedRouteBoost ?? 1.5;
    const gpxExportWeight = tc.gpxExportWeight ?? 40;

    // Telemetry
    if (item.telemetryQuality || (item.telemetry && (item.telemetry.speed > 0 || item.telemetry.maxSpeed > 0))) {
        score *= m.telemetry;

        const lean = item.telemetry?.leanAngle || item.telemetry?.maxLeanAngle || item.maxLeanAngle || 0;
        if (lean >= minLeanAngleThreshold) {
            score *= leanAngleMultiplier;
        }
        if (item.telemetry?.isVerified || item.telemetry?.speedQuality === 'HIGH') {
            score *= speedQualityBonus;
        }
    }

    // Route specific scoring
    if (type === 'route' || item.isRoute || item.geometry || (item.waypoints && item.waypoints.length > 0)) {
        if (item.downloadsCount || item.ridesCount) {
            score += ((item.downloadsCount || 0) + (item.ridesCount || 0)) * gpxExportWeight;
        }
        if (item.isVerified || item.isApexRoute) {
            score *= verifiedRouteBoost;
        }
        if ((item.elevationGain && item.elevationGain > 300) || item.difficulty === 'ADVANCED' || item.difficulty === 'EXPERT') {
            score *= elevationDifficultyWeight;
        }
    }

    // Garage / interest match (one affinity boost at most).
    const viewerSignals = [
        viewerContext.activeBikeModel,
        ...(viewerContext.interests || [])
    ].map(normalizeSignal).filter(Boolean);
    const itemSignals = [item.bikeModel, ...(item.tags || [])]
        .map(normalizeSignal)
        .filter(Boolean);
    const hasAffinity = viewerSignals.some(viewerSignal =>
        itemSignals.some(itemSignal => signalsMatch(viewerSignal, itemSignal))
    );
    if (hasAffinity) {
        score *= m.affinity;
    }

    // Verified Pro (Checking both Post and Reel schema user contexts)
    const rank = item.userRank || (item.userId && item.userId.rank ? item.userId.rank : null);
    const verified = (item.userId && item.userId.isVerified);
    if (rank === 'Pro Rider' || rank === 'MotoVibe Pro' || verified) {
        score *= m.pro;
    }

    // 3. Time Decay (Applies to all)
    if (decay.enabled && item.createdAt) {
        const hoursSincePosted = (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSincePosted > 0) {
            const decayFactor = Math.pow(hoursSincePosted + 2, decay.factor);
            return score / decayFactor;
        }
    }

    return score;
};
