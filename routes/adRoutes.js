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
} from '../controllers/adController.js';
import { protect, checkUser } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public route for mobile feed and packages
router.get('/', getPublicAds);
router.get('/packages', getAdPackages);

// User-Facing Ad Studio Routes
router.get('/my', checkUser, getMyAds);
router.post('/my', checkUser, createMyAd);
router.post('/pay/:adId', checkUser, payForAd);
router.patch('/my/:adId/toggle', checkUser, toggleMyAdStatus);
router.delete('/my/:adId', checkUser, deleteMyAd);

// Admin management routes
router.get('/admin/all', getAllAdsAdmin);
router.post('/admin', createAd);
router.put('/admin/:adId', updateAd);
router.delete('/admin/:adId', deleteAd);

// Interaction & Analytics routes
router.post('/impression/:adId', checkUser, recordImpression);
router.post('/click/:adId', checkUser, recordClick);

export default router;
