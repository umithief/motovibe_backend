import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { raiseHttpError } from '../../utils/httpError.js';

import SponsoredAd from "./model.js";

// Predefined Reach & Pricing Packages
export const AD_PACKAGES = {
  starter: {
    id: 'starter',
    name: 'Başlangıç Sürücü',
    targetImpressions: 1000,
    amount: 199,
    currency: 'TRY',
    description: 'Bireysel sürücüler ve ekipman ilanları için ideal başlangıç.',
    badge: '1.000 GÖSTERİM',
    cpm: '₺0.20 / gösterim'
  },
  pro: {
    id: 'pro',
    name: 'Pro Rider Vitrini',
    targetImpressions: 5000,
    amount: 699,
    currency: 'TRY',
    description: 'Tüm motosiklet tutkunlarına ulaşan en popüler paket.',
    badge: '5.000 GÖSTERİM',
    isPopular: true,
    cpm: '₺0.14 / gösterim'
  },
  biz_garaj: {
    id: 'biz_garaj',
    name: 'MotoVibe BİZ Garaj',
    targetImpressions: 15000,
    amount: 1499,
    currency: 'TRY',
    description: 'Yetkili servisler, aksesuar mağazaları ve yerel garajlar için.',
    badge: '15.000 GÖSTERİM',
    cpm: '₺0.10 / gösterim'
  },
  enterprise: {
    id: 'enterprise',
    name: 'MotoVibe BİZ Enterprise',
    targetImpressions: 50000,
    amount: 3999,
    currency: 'TRY',
    description: 'Marka lansmanları ve bayi ağları için maksimum etki.',
    badge: '50.000 GÖSTERİM',
    cpm: '₺0.08 / gösterim'
  }
};

// Public: Get packages
export const getAdPackages = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  return respond({
    success: true,
    packages: Object.values(AD_PACKAGES)
  },200);

    return response;
};

// Public Feed Ads (Only return active and non-completed ads)
export const getPublicAds = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const filter = { isActive: true, isCompleted: { $ne: true } };
    if (input.query.adType) {
      filter.adType = input.query.adType;
    }
    let ads = await SponsoredAd.find(filter).sort({ createdAt: -1 }).limit(10);

    // If no ads exist, create default MotoVibe BİZ and Rider ads
    if (ads.length === 0) {
      const defaultBizAd = await SponsoredAd.create({
        adType: 'biz',
        businessName: 'Ducati İstanbul Garaj',
        businessProfilePic: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=500',
        mediaUrls: [
          'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1000',
          'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1000'
        ],
        caption: '2026 Panigale V4 S lansmanına özel servis ve test sürüşü günleri başladı! Rezervasyonunu hemen yap.',
        ctaText: 'Randevu Al',
        ctaLink: 'https://motovibe.app/biz/ducati-istanbul',
        targetAudience: { minCcRequirement: 600, cities: ['İstanbul'] },
        isActive: true,
        isCompleted: false,
        payment: {
          packageId: 'biz_garaj',
          packageName: 'MotoVibe BİZ Garaj',
          amount: 1499,
          currency: 'TRY',
          targetImpressions: 15000,
          status: 'paid',
          paymentMethod: 'credit_card',
          transactionId: `TXN_DEMO_${Date.now()}`,
          paidAt: new Date()
        },
        metrics: { impressions: 142, clicks: 28 }
      });
      ads = [defaultBizAd];
    }

    return respond({ success: true, ads },200);
  } catch (error) { throw error; }

    return response;
};

// Admin: Get all ads with CTR metrics
export const getAllAdsAdmin = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const query = {};
    if (input.query.adType) {
      query.adType = input.query.adType;
    }
    const ads = await SponsoredAd.find(query).sort({ createdAt: -1 });
    const formattedAds = ads.map(ad => {
      const impressions = ad.metrics?.impressions || 0;
      const clicks = ad.metrics?.clicks || 0;
      const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0.00';
      return {
        ...ad.toObject(),
        ctr: `${ctr}%`
      };
    });
    return respond({ success: true, ads: formattedAds },200);
  } catch (error) { throw error; }

    return response;
};

// Admin: Create new sponsored ad
export const createAd = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const {
      adType,
      businessName,
      businessProfilePic,
      mediaUrls,
      caption,
      ctaText,
      ctaLink,
      targetAudience,
      isActive
    } = input.body;

    if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      return raiseHttpError({ success: false, error: 'En az bir medya URL gereklidir.' },400);
    }

    const newAd = new SponsoredAd({
      adType: adType || 'biz',
      businessName: businessName || 'MotoVibe BİZ Partner',
      businessProfilePic: businessProfilePic || 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=500',
      mediaUrls,
      caption: caption || '',
      ctaText: ctaText || 'Detaylı Bilgi',
      ctaLink: ctaLink || 'https://motovibe.app',
      targetAudience: targetAudience || { minCcRequirement: 0, cities: [] },
      isActive: isActive !== undefined ? isActive : true,
      metrics: { impressions: 0, clicks: 0 }
    });

    await newAd.save();
    return respond({ success: true, ad: newAd },201);
  } catch (error) { throw error; }

    return response;
};

// Admin: Update sponsored ad (status, caption, link, etc.)
export const updateAd = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const { adId } = input.params;
    const updatedAd = await SponsoredAd.findByIdAndUpdate(adId, input.body, { new: true });
    if (!updatedAd) {
      return raiseHttpError({ success: false, error: 'Reklam bulunamadı.' },404);
    }
    return respond({ success: true, ad: updatedAd },200);
  } catch (error) { throw error; }

    return response;
};

// Admin: Delete ad
export const deleteAd = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const { adId } = input.params;
    await SponsoredAd.findByIdAndDelete(adId);
    return respond({ success: true, message: 'Reklam silindi.' },200);
  } catch (error) { throw error; }

    return response;
};

export const recordImpression = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const { adId } = input.params;
    // Identify viewer by authenticated userId, or client-provided deviceId/userId, or IP fallback
    const viewerIdentifier =
      input.user?._id?.toString() ||
      input.body?.deviceId ||
      input.body?.userId ||
      input.headers['x-forwarded-for'] ||
      input.socket?.remoteAddress ||
      'anonymous';

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return raiseHttpError({ success: false, error: 'Reklam bulunamadı.' },404);
    }

    const now = new Date();
    const COOLDOWN_MS = 60 * 60 * 1000; // 1 Saatlik Frekans Limiti (Frequency Capping)

    ad.viewerLogs = ad.viewerLogs || [];

    if (viewerIdentifier !== 'anonymous') {
      const recentLog = ad.viewerLogs
        .filter(l => l.identifier === viewerIdentifier)
        .sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))[0];

      if (recentLog && (now - new Date(recentLog.viewedAt)) < COOLDOWN_MS) {
        // Frekans sınırı: 1 saat içinde aynı kullanıcı tekrar gördü, bütçeyi DÜŞÜRME
        return respond({
          success: true,
          deduplicated: true,
          message: 'Frekans limiti koruması aktif: 1 saat içindeki mükerrer gösterim sayılmadı.',
          impressions: ad.metrics?.impressions || 0,
          uniqueReach: ad.metrics?.uniqueReach || 0,
          isCompleted: ad.isCompleted
        },200);
      }

      // Tekil erişim (Unique Reach) kontrolü
      const hasViewedBefore = ad.viewerLogs.some(l => l.identifier === viewerIdentifier);
      if (!hasViewedBefore) {
        ad.metrics.uniqueReach = (ad.metrics.uniqueReach || 0) + 1;
      }

      // Son logu ekle ve döküman boyutunu korumak için son 500 kayıtta sınırla
      ad.viewerLogs.push({ identifier: viewerIdentifier, viewedAt: now });
      if (ad.viewerLogs.length > 500) {
        ad.viewerLogs = ad.viewerLogs.slice(-500);
      }
    } else {
      ad.metrics.uniqueReach = (ad.metrics.uniqueReach || 0) + 1;
    }

    // Geçerli gösterimi artır
    ad.metrics.impressions = (ad.metrics.impressions || 0) + 1;

    // Hedef gösterim kotası kontrolü
    const targetImpressions = ad.payment?.targetImpressions || 0;
    if (targetImpressions > 0 && ad.metrics.impressions >= targetImpressions) {
      ad.isActive = false;
      ad.isCompleted = true;
    }

    await ad.save();
    return respond({
      success: true,
      deduplicated: false,
      message: 'Gösterim metrikleri başarıyla güncellendi.',
      impressions: ad.metrics.impressions,
      uniqueReach: ad.metrics.uniqueReach,
      isCompleted: ad.isCompleted
    },200);
  } catch (error) { throw error; }

    return response;
};

export const recordClick = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const { adId } = input.params;
    await SponsoredAd.findByIdAndUpdate(adId, {
      $inc: { 'metrics.clicks': 1 }
    });
    return respond({ success: true, message: 'Tıklama (CTR) metrikleri güncellendi.' },200);
  } catch (error) { throw error; }

    return response;
};

// USER: Get current user's sponsored ads
export const getMyAds = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const userId = input.user?._id;
    const query = userId ? { $or: [{ userId }, { businessId: userId }] } : {};
    if (input.query.adType) {
      query.adType = input.query.adType;
    }
    const ads = await SponsoredAd.find(query).sort({ createdAt: -1 });

    const formattedAds = ads.map(ad => {
      const impressions = ad.metrics?.impressions || 0;
      const clicks = ad.metrics?.clicks || 0;
      const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0.00';
      return {
        ...ad.toObject(),
        ctr: `${ctr}%`
      };
    });

    return respond({ success: true, ads: formattedAds },200);
  } catch (error) { throw error; }

    return response;
};

// USER: Create own sponsored ad with chosen reach package and simulated payment
export const createMyAd = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const userId = input.user?._id;
    const {
      adType,
      businessName,
      businessProfilePic,
      mediaUrls,
      caption,
      ctaText,
      ctaLink,
      targetAudience,
      packageId = 'starter',
      paymentMethod = 'credit_card'
    } = input.body;

    if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      return raiseHttpError({ success: false, error: 'En az bir medya URL gereklidir.' },400);
    }

    const selectedPkg = AD_PACKAGES[packageId] || AD_PACKAGES.starter;
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const newAd = new SponsoredAd({
      userId: userId || null,
      adType: adType || (input.user?.isProfessional ? 'biz' : 'user'),
      businessName: businessName || input.user?.name || input.user?.username || 'MotoVibe Sürücüsü',
      businessProfilePic: businessProfilePic || input.user?.avatar || input.user?.profileImage || 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=500',
      mediaUrls,
      caption: caption || '',
      ctaText: ctaText || 'Detaylı Bilgi',
      ctaLink: ctaLink || 'https://motovibe.app',
      targetAudience: targetAudience || { minCcRequirement: 0, cities: [] },
      isActive: true,
      isCompleted: false,
      payment: {
        packageId: selectedPkg.id,
        packageName: selectedPkg.name,
        amount: selectedPkg.amount,
        currency: selectedPkg.currency,
        targetImpressions: selectedPkg.targetImpressions,
        status: 'paid',
        paymentMethod: paymentMethod,
        transactionId,
        paidAt: new Date()
      },
      metrics: { impressions: 0, clicks: 0 }
    });

    await newAd.save();
    return respond({ success: true, ad: newAd, transactionId },201);
  } catch (error) { throw error; }

    return response;
};

// USER / AD PAYMENT: Renew impressions quota or pay for ad
export const payForAd = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const { adId } = input.params;
    const { packageId = 'starter', paymentMethod = 'credit_card' } = input.body;
    const userId = input.user?._id;

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return raiseHttpError({ success: false, error: 'Reklam bulunamadı.' },404);
    }

    if (userId && ad.userId && ad.userId.toString() !== userId.toString()) {
      return raiseHttpError({ success: false, error: 'Bu reklamı yenileme yetkiniz yok.' },403);
    }

    const selectedPkg = AD_PACKAGES[packageId] || AD_PACKAGES.starter;
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // Add new impressions quota on top of current impressions
    const newTarget = (ad.metrics?.impressions || 0) + selectedPkg.targetImpressions;

    ad.payment = {
      packageId: selectedPkg.id,
      packageName: selectedPkg.name,
      amount: selectedPkg.amount,
      currency: selectedPkg.currency,
      targetImpressions: newTarget,
      status: 'paid',
      paymentMethod: paymentMethod,
      transactionId,
      paidAt: new Date()
    };
    ad.isActive = true;
    ad.isCompleted = false;

    await ad.save();
    return respond({ success: true, ad, transactionId },200);
  } catch (error) { throw error; }

    return response;
};

// USER: Toggle own ad active state
export const toggleMyAdStatus = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const { adId } = input.params;
    const userId = input.user?._id;

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return raiseHttpError({ success: false, error: 'Reklam bulunamadı.' },404);
    }

    // Permission check if userId exists
    if (userId && ad.userId && ad.userId.toString() !== userId.toString()) {
      return raiseHttpError({ success: false, error: 'Bu reklamı düzenleme yetkiniz yok.' },403);
    }

    ad.isActive = !ad.isActive;
    await ad.save();

    return respond({ success: true, ad },200);
  } catch (error) { throw error; }

    return response;
};

// USER: Delete own ad
export const deleteMyAd = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const { adId } = input.params;
    const userId = input.user?._id;

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return raiseHttpError({ success: false, error: 'Reklam bulunamadı.' },404);
    }

    if (userId && ad.userId && ad.userId.toString() !== userId.toString()) {
      return raiseHttpError({ success: false, error: 'Bu reklamı silme yetkiniz yok.' },403);
    }

    await SponsoredAd.findByIdAndDelete(adId);
    return respond({ success: true, message: 'Reklam silindi.' },200);
  } catch (error) { throw error; }

    return response;
};
