import Campaign from '../models/Campaign.js';
import UserChallenge from '../models/UserChallenge.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/appError.js';

const CAMPAIGN_TYPES = new Set(['MAP_PIN', 'CHALLENGE', 'SPONSORED_ROUTE']);
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const parseBoolean = (value, fallback = true) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === 'true' || value === 1 || value === '1') {
        return true;
    }
    if (value === 'false' || value === 0 || value === '0') {
        return false;
    }
    return fallback;
};

const parseDateOrNull = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeReward = (input, fallback = {}) => {
    const raw = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    return {
        badgeUrl: cleanString(raw.badgeUrl ?? base.badgeUrl),
        discountCode: cleanString(raw.discountCode ?? base.discountCode),
        description: cleanString(raw.description ?? base.description),
    };
};

const buildLocation = (latRaw, lngRaw) => {
    const lat = parseFiniteNumber(latRaw);
    const lng = parseFiniteNumber(lngRaw);

    if (lat === null || lng === null) {
        throw new AppError('MAP_PIN kampanyası için geçerli enlem ve boylam zorunludur.', 400);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new AppError('Koordinatlar geçersiz. Enlem -90..90, boylam -180..180 olmalıdır.', 400);
    }

    return {
        type: 'Point',
        coordinates: [lng, lat],
    };
};

const normalizeCreatePayload = (body) => {
    const sponsorName = cleanString(body?.sponsorName);
    const brandLogo = cleanString(body?.brandLogo);
    const type = cleanString(body?.type).toUpperCase();
    const title = cleanString(body?.title);
    const description = cleanString(body?.description);
    const targetMetric = parseFiniteNumber(body?.targetMetric) ?? 0;
    const rawBrandColor = cleanString(body?.brandColor || '#E2FF3B');
    const activeUntil =
        parseDateOrNull(body?.activeUntil) ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (!sponsorName) {
        throw new AppError('Sponsor adı zorunludur.', 400);
    }
    if (!brandLogo) {
        throw new AppError('Sponsor logo URL alanı zorunludur.', 400);
    }
    if (!title) {
        throw new AppError('Kampanya başlığı zorunludur.', 400);
    }
    if (!CAMPAIGN_TYPES.has(type)) {
        throw new AppError('Kampanya tipi geçersiz.', 400);
    }
    if (targetMetric < 0) {
        throw new AppError('Hedef metrik negatif olamaz.', 400);
    }
    if (!HEX_COLOR_REGEX.test(rawBrandColor)) {
        throw new AppError('Marka rengi HEX formatında olmalıdır (örn: #E2FF3B).', 400);
    }

    const payload = {
        sponsorName,
        brandLogo,
        type,
        title,
        description,
        reward: normalizeReward(body?.reward),
        targetMetric,
        brandColor: rawBrandColor.toUpperCase(),
        activeUntil,
        isActive: parseBoolean(body?.isActive, true),
    };

    if (type === 'MAP_PIN') {
        payload.location = buildLocation(body?.lat, body?.lng);
    }

    return payload;
};

const normalizeUpdatePayload = (body, existingCampaign) => {
    const payload = {};
    const nextType = body?.type
        ? cleanString(body.type).toUpperCase()
        : existingCampaign.type;

    if (!CAMPAIGN_TYPES.has(nextType)) {
        throw new AppError('Kampanya tipi geçersiz.', 400);
    }

    if (body?.type !== undefined) {
        payload.type = nextType;
    }

    if (body?.sponsorName !== undefined) {
        const sponsorName = cleanString(body.sponsorName);
        if (!sponsorName) {
            throw new AppError('Sponsor adı boş bırakılamaz.', 400);
        }
        payload.sponsorName = sponsorName;
    }

    if (body?.brandLogo !== undefined) {
        const brandLogo = cleanString(body.brandLogo);
        if (!brandLogo) {
            throw new AppError('Sponsor logo URL boş bırakılamaz.', 400);
        }
        payload.brandLogo = brandLogo;
    }

    if (body?.title !== undefined) {
        const title = cleanString(body.title);
        if (!title) {
            throw new AppError('Kampanya başlığı boş bırakılamaz.', 400);
        }
        payload.title = title;
    }

    if (body?.description !== undefined) {
        payload.description = cleanString(body.description);
    }

    if (body?.targetMetric !== undefined) {
        const targetMetric = parseFiniteNumber(body.targetMetric);
        if (targetMetric === null || targetMetric < 0) {
            throw new AppError('Hedef metrik 0 veya daha büyük bir sayı olmalıdır.', 400);
        }
        payload.targetMetric = targetMetric;
    }

    if (body?.reward !== undefined) {
        if (body.reward !== null && typeof body.reward !== 'object') {
            throw new AppError('Ödül bilgisi geçersiz.', 400);
        }
        payload.reward = normalizeReward(body.reward, existingCampaign.reward?.toObject?.());
    }

    if (body?.brandColor !== undefined) {
        const brandColor = cleanString(body.brandColor);
        if (!HEX_COLOR_REGEX.test(brandColor)) {
            throw new AppError('Marka rengi HEX formatında olmalıdır (örn: #E2FF3B).', 400);
        }
        payload.brandColor = brandColor.toUpperCase();
    }

    if (body?.activeUntil !== undefined) {
        const activeUntil = parseDateOrNull(body.activeUntil);
        if (!activeUntil) {
            throw new AppError('Bitiş tarihi geçersiz.', 400);
        }
        payload.activeUntil = activeUntil;
    }

    if (body?.isActive !== undefined) {
        payload.isActive = parseBoolean(body.isActive, existingCampaign.isActive);
    }

    const hasLat = Object.prototype.hasOwnProperty.call(body || {}, 'lat');
    const hasLng = Object.prototype.hasOwnProperty.call(body || {}, 'lng');
    let shouldUnsetLocation = false;

    if (nextType === 'MAP_PIN') {
        if (hasLat !== hasLng) {
            throw new AppError('MAP_PIN kampanyasında enlem ve boylam birlikte gönderilmelidir.', 400);
        }
        if (hasLat && hasLng) {
            payload.location = buildLocation(body.lat, body.lng);
        } else {
            const existingCoordinates = existingCampaign?.location?.coordinates;
            if (!Array.isArray(existingCoordinates) || existingCoordinates.length < 2) {
                throw new AppError('MAP_PIN kampanyası için konum bilgisi zorunludur.', 400);
            }
        }
    } else {
        shouldUnsetLocation = body?.type !== undefined && existingCampaign?.location;
        if (hasLat || hasLng) {
            throw new AppError('Konum bilgisi sadece MAP_PIN kampanyalarında kullanılabilir.', 400);
        }
    }

    return { payload, shouldUnsetLocation };
};

// GET /api/campaigns — Active campaigns list
export const getCampaigns = catchAsync(async (req, res) => {
    const now = new Date();
    const requestedTypes = cleanString(req.query.types)
        .split(',')
        .map((item) => cleanString(item).toUpperCase())
        .filter((item) => item && CAMPAIGN_TYPES.has(item));

    const query = {
        isActive: true,
        activeUntil: { $gte: now },
    };

    if (requestedTypes.length > 0) {
        query.type = { $in: requestedTypes };
    }

    const campaigns = await Campaign.find(query)
        .sort('-createdAt')
        .lean();

    res.status(200).json({ status: 'success', data: { campaigns } });
});

// GET /api/campaigns/pins?lat=&lng=&radius= — Nearby MAP_PIN campaigns
export const getNearbyPins = catchAsync(async (req, res, next) => {
    const latRaw = req.query.lat;
    const lngRaw = req.query.lng;
    const radiusRaw = req.query.radius;
    const now = new Date();

    const query = {
        type: 'MAP_PIN',
        isActive: true,
        activeUntil: { $gte: now },
    };

    const hasLat = latRaw !== undefined;
    const hasLng = lngRaw !== undefined;
    if (hasLat !== hasLng) {
        return next(new AppError('Yakındaki kampanyaları filtrelemek için enlem ve boylam birlikte gönderilmelidir.', 400));
    }

    if (hasLat && hasLng) {
        const lat = parseFiniteNumber(latRaw);
        const lng = parseFiniteNumber(lngRaw);
        if (lat === null || lng === null) {
            return next(new AppError('Koordinatlar geçersiz.', 400));
        }

        const radius = parseFiniteNumber(radiusRaw);
        const safeRadius = radius && radius > 0 ? Math.min(Math.round(radius), 50000) : 5000;

        query.location = {
            $near: {
                $geometry: { type: 'Point', coordinates: [lng, lat] },
                $maxDistance: safeRadius,
            },
        };
    }

    const pins = await Campaign.find(query).lean();
    res.status(200).json({ status: 'success', data: { pins } });
});

// GET /api/campaigns/my — Authenticated user's active challenges
export const getMyChallenges = catchAsync(async (req, res) => {
    const challenges = await UserChallenge.find({ user: req.user._id })
        .populate({
            path: 'campaign',
            match: { isActive: true },
        })
        .lean();

    const active = challenges.filter((challenge) => challenge.campaign !== null);
    res.status(200).json({ status: 'success', data: { challenges: active } });
});

// POST /api/campaigns/:id/join — Join a challenge
export const joinCampaign = catchAsync(async (req, res, next) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign || !campaign.isActive || campaign.activeUntil < new Date()) {
        return next(new AppError('Kampanya bulunamadı veya süresi dolmuş.', 404));
    }

    const existing = await UserChallenge.findOne({
        user: req.user._id,
        campaign: campaign._id,
    });
    if (existing) {
        return next(new AppError('Bu göreve zaten katıldınız.', 409));
    }

    const challenge = await UserChallenge.create({
        user: req.user._id,
        campaign: campaign._id,
        currentMetric: 0,
        isCompleted: false,
    });

    res.status(201).json({ status: 'success', data: { challenge } });
});

// POST /api/campaigns/:id/claim — Claim reward
export const claimReward = catchAsync(async (req, res, next) => {
    const challenge = await UserChallenge.findOne({
        user: req.user._id,
        campaign: req.params.id,
    }).populate('campaign');

    if (!challenge) {
        return next(new AppError('Göreve katılmadınız.', 404));
    }
    if (!challenge.isCompleted) {
        return next(new AppError('Görev henüz tamamlanmadı.', 400));
    }
    if (challenge.rewardClaimed) {
        return next(new AppError('Ödül zaten alındı.', 409));
    }

    challenge.rewardClaimed = true;
    challenge.claimedAt = new Date();
    await challenge.save();

    res.status(200).json({
        status: 'success',
        data: {
            reward: challenge.campaign.reward,
        },
    });
});

// GET /api/admin/campaigns — All campaigns with participant counts
export const adminGetCampaigns = catchAsync(async (req, res) => {
    const [campaigns, stats] = await Promise.all([
        Campaign.find().sort('-createdAt').lean(),
        UserChallenge.aggregate([
            {
                $group: {
                    _id: '$campaign',
                    participants: { $sum: 1 },
                    completed: {
                        $sum: {
                            $cond: [{ $eq: ['$isCompleted', true] }, 1, 0],
                        },
                    },
                },
            },
        ]),
    ]);

    const statsMap = new Map(
        stats.map((item) => [
            item._id?.toString(),
            {
                participants: item.participants || 0,
                completed: item.completed || 0,
            },
        ]),
    );

    const withStats = campaigns.map((campaign) => ({
        ...campaign,
        stats: statsMap.get(campaign._id.toString()) || {
            participants: 0,
            completed: 0,
        },
    }));

    res.status(200).json({ status: 'success', data: { campaigns: withStats } });
});

// POST /api/admin/campaigns — Create campaign
export const adminCreateCampaign = catchAsync(async (req, res) => {
    const payload = normalizeCreatePayload(req.body);
    const campaign = await Campaign.create(payload);
    res.status(201).json({ status: 'success', data: { campaign } });
});

// PUT /api/admin/campaigns/:id — Update campaign
export const adminUpdateCampaign = catchAsync(async (req, res, next) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
        return next(new AppError('Kampanya bulunamadı.', 404));
    }

    const { payload, shouldUnsetLocation } = normalizeUpdatePayload(req.body, campaign);
    Object.assign(campaign, payload);
    if (shouldUnsetLocation) {
        campaign.location = undefined;
    }

    await campaign.save();
    res.status(200).json({ status: 'success', data: { campaign } });
});

// DELETE /api/admin/campaigns/:id — Delete campaign + all user challenges
export const adminDeleteCampaign = catchAsync(async (req, res, next) => {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) {
        return next(new AppError('Kampanya bulunamadı.', 404));
    }

    await UserChallenge.deleteMany({ campaign: req.params.id });
    res.status(200).json({
        status: 'success',
        message: 'Kampanya ve ilişkili katılımlar silindi.',
    });
});
