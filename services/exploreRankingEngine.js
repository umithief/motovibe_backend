/**
 * exploreRankingEngine.js
 * MotoVibe — Keşfet Öne Çıkan Telemetri ve Rota Sıralama Motoru (Apex Algoritması)
 */

/**
 * Rota için Öne Çıkarma Skoru (Route Featured Score - S_route)
 * @param {Object} route Mongoose Route dökümanı
 * @returns {number} 0-1000 arası ağırlıklı puan
 */
export function calculateRouteFeaturedScore(route) {
    if (!route) return 0;

    // 1. Bayesian Weighted Rating (Düşük oylu rotaların manipülasyonunu engeller)
    const reviewCount = Array.isArray(route.reviews) ? route.reviews.length : 0;
    const rawRating = Number(route.rating) || 4.0;
    const minReviewsWeight = 3;
    const globalMean = 4.0;
    const bayesianRating = (reviewCount * rawRating + minReviewsWeight * globalMean) / (reviewCount + minReviewsWeight);
    const ratingScore = bayesianRating * 30; // Max 150

    // 2. Popülarite & Sürüş Hacmi (Logaritmik Sönümleme)
    const riderCount = Math.max(0, Number(route.riderCount) || 0);
    const riderVolumeScore = Math.log(1 + riderCount) * 25; // Logaritmik artış

    // 3. Motosiklet Odaklı Teknik Viraj ve Yol Kalitesi Faktörü
    const curves = Math.max(0, Number(route.stats?.curves) || 0);
    const curveScore = Math.min(100, curves * 2.0); // Viraj yoğunluğu
    const roadQuality = Math.min(5, Math.max(1, Number(route.stats?.roadQuality) || 3));
    const qualityScore = (roadQuality / 5) * 40;
    const scenery = Math.min(5, Math.max(1, Number(route.difficultyMetrics?.scenery) || 3));
    const sceneryScore = (scenery / 5) * 40;

    // 4. Medya & Zengin İçerik Bonusları
    let mediaScore = 0;
    if (route.image && route.image.trim().length > 0) mediaScore += 35;
    const photoCount = Array.isArray(route.photos) ? route.photos.length : 0;
    mediaScore += Math.min(30, photoCount * 10);
    if (route.distanceMeters && route.distanceMeters > 5000) mediaScore += 15; // Gerçek GPS rotası

    // 5. Zaman Sönümlemesi (Recency Decay)
    const ageDays = Math.max(0, (Date.now() - new Date(route.createdAt || route.updatedAt || Date.now()).getTime()) / (1000 * 60 * 60 * 24));
    const timeDecay = 1 / (1 + 0.08 * (ageDays / 14)); // 14 günlük kademeli sönümleme

    const baseScore = ratingScore + riderVolumeScore + curveScore + qualityScore + sceneryScore + mediaScore;
    return Math.round(baseScore * timeDecay * 10) / 10;
}

/**
 * Telemetri için Öne Çıkarma Skoru (Telemetry Featured Score - S_telemetry)
 * @param {Object} post Mongoose SocialPost dökümanı
 * @returns {number} 0-1000 arası ağırlıklı puan
 */
export function calculateTelemetryFeaturedScore(post) {
    if (!post) return 0;

    // Telemetri verilerini çıkart
    const tele = post.telemetry || post.rideStats || {};
    const leanAngle = Math.max(0, Number(tele.leanAngle) || 0);
    const speed = Math.max(0, Number(tele.speed || tele.maxSpeed) || 0);
    const gForce = Math.max(0, Number(tele.gForce) || 0);
    const distance = Math.max(0, Number(tele.distance) || 0);

    const hasTrueTelemetry = (leanAngle > 0 || speed > 0 || gForce > 0);

    // 1. Dinamik Telemetri Heyecan İndeksi
    // Motosiklette 40°-55° arası yatış açısı zirve performans kabul edilir
    const leanScore = leanAngle > 0 ? Math.min(55, leanAngle) * 2.4 : 0; // 50° = 120 puan
    const speedScore = speed > 0 ? Math.log(1 + speed) * 16 : 0; // 150 km/s = ~80 puan
    const gForceScore = Math.min(50, gForce * 30);
    const distanceScore = Math.log(1 + distance) * 12;

    // 2. Telemetri Görsel Zenginliği (HUD / Overlay)
    let overlayBonus = 0;
    if (post.telemetryQuality || post.media?.[0]?.isHudOverlayActive) {
        overlayBonus += 50; // HUD telemetri grafiği olanlar öne fırlar
    }
    if (hasTrueTelemetry) {
        overlayBonus += 30;
    }

    // 3. Etkileşim Skoru (Sosyal Doğrulama)
    const likes = Math.max(0, Number(post.likeCount || post.likes?.length) || 0);
    const comments = Math.max(0, Number(post.commentCount) || 0);
    const engagementScore = (likes * 2.5) + (comments * 5.0);

    // 4. Pilot Otoritesi & Rozet
    let pilotBonus = 0;
    if (post.user?.isVerified || post.isVerified) pilotBonus += 25;
    const rank = (post.userRank || post.user?.rank || '').toLowerCase();
    if (rank.includes('efsane') || rank.includes('elit') || rank.includes('komutan')) {
        pilotBonus += 20;
    }

    // 5. Üstel Zaman Çürümesi (Exponential Recency Decay - 72 saatlik yarı ömür)
    const ageHours = Math.max(0, (Date.now() - new Date(post.createdAt || Date.now()).getTime()) / (1000 * 60 * 60));
    const halfLifeHours = 72; // 3 gün
    const timeDecay = Math.exp(-ageHours / halfLifeHours);

    const baseScore = (leanScore + speedScore + gForceScore + distanceScore + overlayBonus + engagementScore + pilotBonus);
    return Math.round(baseScore * Math.max(0.1, timeDecay) * 10) / 10;
}

/**
 * Telemetri ve Rotaları skorlayıp, çeşitlilik filtreleri uygulayarak
 * akıllı 2:1 zikzak dizilimle harmanlar.
 */
export function rankAndInterleaveTrending(posts, routes, options = {}) {
    const maxPosts = options.maxPosts || 12;
    const maxRoutes = options.maxRoutes || 6;

    // 1. Skorla ve sırala
    const rankedPosts = (posts || [])
        .map(post => ({
            ...post,
            telemetryScore: calculateTelemetryFeaturedScore(post)
        }))
        .sort((a, b) => b.telemetryScore - a.telemetryScore)
        .slice(0, maxPosts);

    const rankedRoutes = (routes || [])
        .map(route => ({
            ...route,
            routeScore: calculateRouteFeaturedScore(route)
        }))
        .sort((a, b) => b.routeScore - a.routeScore)
        .slice(0, maxRoutes);

    // 2. Formatla
    const formattedPosts = rankedPosts.map(post => ({
        _id: post._id,
        type: 'post',
        imageUrl: post.media?.[0]?.url || post.images?.[0] || post.mediaUrl,
        userName: post.user?.name || post.userName,
        userAvatar: post.user?.avatar || post.userAvatar,
        isVerified: post.user?.isVerified || post.isVerified || false,
        caption: post.caption || post.content,
        likeCount: post.likeCount || (post.likes ? post.likes.length : 0),
        commentCount: post.commentCount || 0,
        telemetry: post.telemetry,
        rideStats: post.rideStats,
        createdAt: post.createdAt,
        hotnessScore: post.telemetryScore
    }));

    const formattedRoutes = rankedRoutes.map(route => ({
        _id: route._id,
        type: 'route',
        imageUrl: route.image || route.photos?.[0],
        title: route.title,
        description: route.description,
        difficulty: route.difficulty,
        distance: route.distance || (route.distanceMeters ? `${Math.round(route.distanceMeters / 1000)} km` : null),
        rating: route.rating,
        location: route.location,
        hotnessScore: route.routeScore
    }));

    // 3. Akıllı 2:1 Interleaving (2 Telemetri : 1 Rota)
    const items = [];
    let pi = 0;
    let ri = 0;
    while (pi < formattedPosts.length || ri < formattedRoutes.length) {
        if (pi < formattedPosts.length) items.push(formattedPosts[pi++]);
        if (pi < formattedPosts.length) items.push(formattedPosts[pi++]);
        if (ri < formattedRoutes.length) items.push(formattedRoutes[ri++]);
    }

    return items;
}
