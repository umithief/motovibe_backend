import express from 'express';
import {
  followTag,
  getTagDetails,
  getTrendingTags,
  searchTags,
  unfollowTag,
} from "./controller.js";
import { checkUser, protect } from "../../middleware/authMiddleware.js";

const router = express.Router();

/**
 * @openapi
 * /api/tags/trending:
 *   get:
 *     tags: [Tags]
 *     summary: Trend etiketleri getir
 *     description: Takipçi/gönderi sayısına göre sıralı popüler etiketleri döner. Opsiyonel kimlik doğrulama (checkUser) — token gönderilirse her etiket için `isFollowing` hesaplanır.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 30 }
 *         description: Döndürülecek etiket sayısı (1-30).
 *     responses:
 *       200:
 *         description: Trend etiket listesi.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Tag' }
 */
router.get('/trending', checkUser, getTrendingTags);

/**
 * @openapi
 * /api/tags/search:
 *   get:
 *     tags: [Tags]
 *     summary: Etiket ara (otomatik tamamlama)
 *     description: 'Ön ek eşleşmesiyle etiket arar. Opsiyonel kimlik doğrulama. Sorgu boşsa boş dizi döner.'
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Arama terimi.
 *         example: moto
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12, maximum: 30 }
 *     responses:
 *       200:
 *         description: Eşleşen etiketler.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Tag' }
 */
router.get('/search', checkUser, searchTags);

/**
 * @openapi
 * /api/tags/{name}:
 *   get:
 *     tags: [Tags]
 *     summary: Tek etiket detayı
 *     description: Belirtilen etiketin detaylarını döner. Opsiyonel kimlik doğrulama.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Etiket adı (# olmadan).
 *         example: motogezi
 *     responses:
 *       200:
 *         description: Etiket detayı.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Tag' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:name', checkUser, getTagDetails);

router.use(protect);

/**
 * @openapi
 * /api/tags/{name}/follow:
 *   post:
 *     tags: [Tags]
 *     summary: Etiketi takip et
 *     description: Belirtilen etiketi takip eder; etiket yoksa oluşturulur (upsert).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         example: motogezi
 *     responses:
 *       200:
 *         description: Takip edildi.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TagFollowResult' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/:name/follow', followTag);

/**
 * @openapi
 * /api/tags/{name}/unfollow:
 *   post:
 *     tags: [Tags]
 *     summary: Etiket takibini bırak
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         example: motogezi
 *     responses:
 *       200:
 *         description: Takip bırakıldı.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TagFollowResult' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/:name/unfollow', unfollowTag);

export default router;
