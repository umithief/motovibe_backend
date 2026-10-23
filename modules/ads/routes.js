import express from 'express';
import {
  getPublicAds,
  getAdPackages,
  getAllAdsAdmin,
  createAd,
  updateAd,
  deleteAd,
  recordImpression,
  recordClick,
  getMyAds,
  createMyAd,
  payForAd,
  toggleMyAdStatus,
  deleteMyAd
} from "./controller.js";
import { protect, checkUser } from "../../middleware/authMiddleware.js";

const router = express.Router();

/**
 * @openapi
 * /api/ads:
 *   get:
 *     tags: [Ads]
 *     summary: Herkese açık reklam akışı
 *     description: Aktif ve tamamlanmamış reklamları (en fazla 10) döner. Hiç reklam yoksa varsayılan demo reklam üretilir.
 *     parameters:
 *       - in: query
 *         name: adType
 *         schema: { type: string, enum: [biz, user] }
 *         description: Reklam türüne göre filtrele.
 *     responses:
 *       200:
 *         description: Reklam listesi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ads:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Ad' }
 */
router.get('/', getPublicAds);

/**
 * @openapi
 * /api/ads/packages:
 *   get:
 *     tags: [Ads]
 *     summary: Reklam paketlerini listele
 *     description: Önceden tanımlı erişim/fiyatlandırma paketlerini döner.
 *     responses:
 *       200:
 *         description: Paket listesi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 packages:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AdPackage' }
 */
router.get('/packages', getAdPackages);

/**
 * @openapi
 * /api/ads/my:
 *   get:
 *     tags: [Ads]
 *     summary: Kendi reklamlarım
 *     description: Oturum açan kullanıcının reklamlarını CTR metrikleriyle döner. Opsiyonel kimlik doğrulama (checkUser).
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: query
 *         name: adType
 *         schema: { type: string, enum: [biz, user] }
 *     responses:
 *       200:
 *         description: Reklam listesi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ads:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Ad' }
 */
router.get('/my', checkUser, getMyAds);

/**
 * @openapi
 * /api/ads/my:
 *   post:
 *     tags: [Ads]
 *     summary: Reklam oluştur (kullanıcı reklam stüdyosu)
 *     description: Seçilen erişim paketi ve simüle edilmiş ödeme ile yeni sponsorlu reklam oluşturur. Opsiyonel kimlik doğrulama.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mediaUrls]
 *             properties:
 *               mediaUrls:
 *                 type: array
 *                 items: { type: string }
 *                 minItems: 1
 *                 example: ['https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1000']
 *               adType: { type: string, enum: [biz, user], example: user }
 *               businessName: { type: string, example: 'Ahmet''in Garajı' }
 *               businessProfilePic: { type: string }
 *               caption: { type: string, maxLength: 500, example: 'İkinci el kaskımı satıyorum.' }
 *               ctaText: { type: string, enum: ['Detaylı Bilgi', 'Satın Al', 'Randevu Al'], example: 'Satın Al' }
 *               ctaLink: { type: string, example: 'https://motovibe.app' }
 *               targetAudience: { $ref: '#/components/schemas/AdTargetAudience' }
 *               packageId: { type: string, enum: [starter, pro, biz_garaj, enterprise], default: starter }
 *               paymentMethod: { type: string, default: credit_card }
 *     responses:
 *       201:
 *         description: Reklam oluşturuldu.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ad: { $ref: '#/components/schemas/Ad' }
 *                 transactionId: { type: string, example: TXN_1718120000000_ABCDE }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/my', checkUser, createMyAd);

/**
 * @openapi
 * /api/ads/pay/{adId}:
 *   post:
 *     tags: [Ads]
 *     summary: Reklam için ödeme / gösterim kotası yenileme
 *     description: Mevcut reklama yeni gösterim kotası ekler (simüle ödeme). Opsiyonel kimlik doğrulama; sahiplik kontrolü yapılır.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: adId
 *         required: true
 *         schema: { type: string }
 *         example: 652f1a9b2c4d5e6f7a8b9c10
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               packageId: { type: string, enum: [starter, pro, biz_garaj, enterprise], default: starter }
 *               paymentMethod: { type: string, default: credit_card }
 *     responses:
 *       200:
 *         description: Ödeme işlendi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ad: { $ref: '#/components/schemas/Ad' }
 *                 transactionId: { type: string }
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/pay/:adId', checkUser, payForAd);

/**
 * @openapi
 * /api/ads/my/{adId}/toggle:
 *   patch:
 *     tags: [Ads]
 *     summary: Reklamı aktif/pasif yap
 *     description: Kendi reklamının aktiflik durumunu tersine çevirir. Opsiyonel kimlik doğrulama; sahiplik kontrolü yapılır.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: adId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Durum güncellendi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ad: { $ref: '#/components/schemas/Ad' }
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.patch('/my/:adId/toggle', checkUser, toggleMyAdStatus);

/**
 * @openapi
 * /api/ads/my/{adId}:
 *   delete:
 *     tags: [Ads]
 *     summary: Reklamı sil
 *     description: Kendi reklamını siler. Opsiyonel kimlik doğrulama; sahiplik kontrolü yapılır.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: adId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reklam silindi.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessage' }
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/my/:adId', checkUser, deleteMyAd);

/**
 * @openapi
 * /api/ads/admin/all:
 *   get:
 *     tags: [Ads]
 *     summary: '[Admin] Tüm reklamları listele'
 *     description: Tüm reklamları CTR metrikleriyle döner. Yönetim paneli ucu.
 *     parameters:
 *       - in: query
 *         name: adType
 *         schema: { type: string, enum: [biz, user] }
 *     responses:
 *       200:
 *         description: Reklam listesi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ads:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Ad' }
 */
router.get('/admin/all', getAllAdsAdmin);

/**
 * @openapi
 * /api/ads/admin:
 *   post:
 *     tags: [Ads]
 *     summary: '[Admin] Reklam oluştur'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mediaUrls]
 *             properties:
 *               mediaUrls: { type: array, items: { type: string }, minItems: 1 }
 *               adType: { type: string, enum: [biz, user], default: biz }
 *               businessName: { type: string }
 *               businessProfilePic: { type: string }
 *               caption: { type: string }
 *               ctaText: { type: string, enum: ['Detaylı Bilgi', 'Satın Al', 'Randevu Al'] }
 *               ctaLink: { type: string }
 *               targetAudience: { $ref: '#/components/schemas/AdTargetAudience' }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Reklam oluşturuldu.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ad: { $ref: '#/components/schemas/Ad' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/admin', createAd);

/**
 * @openapi
 * /api/ads/admin/{adId}:
 *   put:
 *     tags: [Ads]
 *     summary: '[Admin] Reklamı güncelle'
 *     parameters:
 *       - in: path
 *         name: adId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Ad' }
 *     responses:
 *       200:
 *         description: Reklam güncellendi.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 ad: { $ref: '#/components/schemas/Ad' }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   delete:
 *     tags: [Ads]
 *     summary: '[Admin] Reklamı sil'
 *     parameters:
 *       - in: path
 *         name: adId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reklam silindi.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessage' }
 */
router.put('/admin/:adId', updateAd);
router.delete('/admin/:adId', deleteAd);

/**
 * @openapi
 * /api/ads/impression/{adId}:
 *   post:
 *     tags: [Ads]
 *     summary: Gösterim (impression) kaydet
 *     description: Reklam gösterimini kaydeder. Aynı izleyici için 1 saatlik frekans limiti (frequency capping) uygulanır. Opsiyonel kimlik doğrulama.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: adId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceId: { type: string, description: 'Anonim izleyici tanımlayıcısı', example: device-abc-123 }
 *               userId: { type: string }
 *     responses:
 *       200:
 *         description: Gösterim işlendi (frekans limitine takılırsa deduplicated=true).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 deduplicated: { type: boolean, example: false }
 *                 message: { type: string }
 *                 impressions: { type: integer, example: 143 }
 *                 uniqueReach: { type: integer, example: 119 }
 *                 isCompleted: { type: boolean, example: false }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/impression/:adId', checkUser, recordImpression);

/**
 * @openapi
 * /api/ads/click/{adId}:
 *   post:
 *     tags: [Ads]
 *     summary: Tıklama (click) kaydet
 *     description: Reklam tıklama metriğini (CTR) artırır. Opsiyonel kimlik doğrulama.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: adId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tıklama kaydedildi.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessage' }
 */
router.post('/click/:adId', checkUser, recordClick);

export default router;
