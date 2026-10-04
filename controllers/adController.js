import SponsoredAd from '../models/SponsoredAd.js';

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
export const getAdPackages = async (req, res) => {
  return res.status(200).json({
    success: true,
    packages: Object.values(AD_PACKAGES)
  });
};

// Public Feed Ads (Only return active and non-completed ads)
export const getPublicAds = async (req, res) => {
  try {
    const filter = { isActive: true, isCompleted: { $ne: true } };
    if (req.query.adType) {
      filter.adType = req.query.adType;
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

    return res.status(200).json({ success: true, ads });
  } catch (error) {
    console.error('[getPublicAds Error]:', error);
    return res.status(500).json({ success: false, error: 'Reklamlar getirilemedi.' });
  }
};

// Admin: Get all ads with CTR metrics
export const getAllAdsAdmin = async (req, res) => {
  try {
    const query = {};
    if (req.query.adType) {
      query.adType = req.query.adType;
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
    return res.status(200).json({ success: true, ads: formattedAds });
  } catch (error) {
    console.error('[getAllAdsAdmin Error]:', error);
    return res.status(500).json({ success: false, error: 'Reklam listesi getirilemedi.' });
  }
};

// Admin: Create new sponsored ad
export const createAd = async (req, res) => {
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
    } = req.body;

    if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      return res.status(400).json({ success: false, error: 'En az bir medya URL gereklidir.' });
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
    return res.status(201).json({ success: true, ad: newAd });
  } catch (error) {
    console.error('[createAd Error]:', error);
    return res.status(500).json({ success: false, error: error.message || 'Reklam oluşturulamadı.' });
  }
};

// Admin: Update sponsored ad (status, caption, link, etc.)
export const updateAd = async (req, res) => {
  try {
    const { adId } = req.params;
    const updatedAd = await SponsoredAd.findByIdAndUpdate(adId, req.body, { new: true });
    if (!updatedAd) {
      return res.status(404).json({ success: false, error: 'Reklam bulunamadı.' });
    }
    return res.status(200).json({ success: true, ad: updatedAd });
  } catch (error) {
    console.error('[updateAd Error]:', error);
    return res.status(500).json({ success: false, error: 'Reklam güncellenemedi.' });
  }
};

// Admin: Delete ad
export const deleteAd = async (req, res) => {
  try {
    const { adId } = req.params;
    await SponsoredAd.findByIdAndDelete(adId);
    return res.status(200).json({ success: true, message: 'Reklam silindi.' });
  } catch (error) {
    console.error('[deleteAd Error]:', error);
    return res.status(500).json({ success: false, error: 'Reklam silinemedi.' });
  }
};

export const recordImpression = async (req, res) => {
  try {
    const { adId } = req.params;
    // Identify viewer by authenticated userId, or client-provided deviceId/userId, or IP fallback
    const viewerIdentifier =
      req.user?._id?.toString() ||
      req.body?.deviceId ||
      req.body?.userId ||
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      'anonymous';

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Reklam bulunamadı.' });
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
        return res.status(200).json({
          success: true,
          deduplicated: true,
          message: 'Frekans limiti koruması aktif: 1 saat içindeki mükerrer gösterim sayılmadı.',
          impressions: ad.metrics?.impressions || 0,
          uniqueReach: ad.metrics?.uniqueReach || 0,
          isCompleted: ad.isCompleted
        });
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
    return res.status(200).json({
      success: true,
      deduplicated: false,
      message: 'Gösterim metrikleri başarıyla güncellendi.',
      impressions: ad.metrics.impressions,
      uniqueReach: ad.metrics.uniqueReach,
      isCompleted: ad.isCompleted
    });
  } catch (error) {
    console.error('[recordImpression Error]:', error);
    return res.status(500).json({ success: false, error: 'Gösterim kaydedilemedi.' });
  }
};

export const recordClick = async (req, res) => {
  try {
    const { adId } = req.params;
    await SponsoredAd.findByIdAndUpdate(adId, {
      $inc: { 'metrics.clicks': 1 }
    });
    return res.status(200).json({ success: true, message: 'Tıklama (CTR) metrikleri güncellendi.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Tıklama kaydedilemedi.' });
  }
};

// USER: Get current user's sponsored ads
export const getMyAds = async (req, res) => {
  try {
    const userId = req.user?._id;
    const query = userId ? { $or: [{ userId }, { businessId: userId }] } : {};
    if (req.query.adType) {
      query.adType = req.query.adType;
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

    return res.status(200).json({ success: true, ads: formattedAds });
  } catch (error) {
    console.error('[getMyAds Error]:', error);
    return res.status(500).json({ success: false, error: 'Kullanıcı reklamları getirilemedi.' });
  }
};

// USER: Create own sponsored ad with chosen reach package and simulated payment
export const createMyAd = async (req, res) => {
  try {
    const userId = req.user?._id;
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
    } = req.body;

    if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      return res.status(400).json({ success: false, error: 'En az bir medya URL gereklidir.' });
    }

    const selectedPkg = AD_PACKAGES[packageId] || AD_PACKAGES.starter;
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const newAd = new SponsoredAd({
      userId: userId || null,
      adType: adType || (req.user?.isProfessional ? 'biz' : 'user'),
      businessName: businessName || req.user?.name || req.user?.username || 'MotoVibe Sürücüsü',
      businessProfilePic: businessProfilePic || req.user?.avatar || req.user?.profileImage || 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=500',
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
    return res.status(201).json({ success: true, ad: newAd, transactionId });
  } catch (error) {
    console.error('[createMyAd Error]:', error);
    return res.status(500).json({ success: false, error: error.message || 'Reklam oluşturulamadı.' });
  }
};

// USER / AD PAYMENT: Renew impressions quota or pay for ad
export const payForAd = async (req, res) => {
  try {
    const { adId } = req.params;
    const { packageId = 'starter', paymentMethod = 'credit_card' } = req.body;
    const userId = req.user?._id;

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Reklam bulunamadı.' });
    }

    if (userId && ad.userId && ad.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'Bu reklamı yenileme yetkiniz yok.' });
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
    return res.status(200).json({ success: true, ad, transactionId });
  } catch (error) {
    console.error('[payForAd Error]:', error);
    return res.status(500).json({ success: false, error: 'Ödeme işlemi gerçekleştirilemedi.' });
  }
};

// USER: Toggle own ad active state
export const toggleMyAdStatus = async (req, res) => {
  try {
    const { adId } = req.params;
    const userId = req.user?._id;

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Reklam bulunamadı.' });
    }

    // Permission check if userId exists
    if (userId && ad.userId && ad.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'Bu reklamı düzenleme yetkiniz yok.' });
    }

    ad.isActive = !ad.isActive;
    await ad.save();

    return res.status(200).json({ success: true, ad });
  } catch (error) {
    console.error('[toggleMyAdStatus Error]:', error);
    return res.status(500).json({ success: false, error: 'Reklam durumu değiştirilemedi.' });
  }
};

// USER: Delete own ad
export const deleteMyAd = async (req, res) => {
  try {
    const { adId } = req.params;
    const userId = req.user?._id;

    const ad = await SponsoredAd.findById(adId);
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Reklam bulunamadı.' });
    }

    if (userId && ad.userId && ad.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'Bu reklamı silme yetkiniz yok.' });
    }

    await SponsoredAd.findByIdAndDelete(adId);
    return res.status(200).json({ success: true, message: 'Reklam silindi.' });
  } catch (error) {
    console.error('[deleteMyAd Error]:', error);
    return res.status(500).json({ success: false, error: 'Reklam silinemedi.' });
  }
};
