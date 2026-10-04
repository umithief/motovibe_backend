import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
    getCampaigns,
    getNearbyPins,
    getMyChallenges,
    joinCampaign,
    claimReward,
    adminGetCampaigns,
    adminCreateCampaign,
    adminUpdateCampaign,
    adminDeleteCampaign,
} from '../controllers/campaignController.js';

const router = express.Router();

// Public
router.get('/', getCampaigns);
router.get('/campaigns', getCampaigns);
router.get('/pins', getNearbyPins);
router.get('/nearby', getNearbyPins);
router.get('/campaigns/pins', getNearbyPins);
router.get('/campaigns/nearby', getNearbyPins);

// Admin routes (available via /admin, /campaigns/admin, and /sponsorship/campaigns/admin)
router.route('/admin')
    .get(protect, admin, adminGetCampaigns)
    .post(protect, admin, adminCreateCampaign);

router.route('/admin/:id')
    .put(protect, admin, adminUpdateCampaign)
    .delete(protect, admin, adminDeleteCampaign);

router.route('/campaigns/admin')
    .get(protect, admin, adminGetCampaigns)
    .post(protect, admin, adminCreateCampaign);

router.route('/campaigns/admin/:id')
    .put(protect, admin, adminUpdateCampaign)
    .delete(protect, admin, adminDeleteCampaign);

// Authenticated Rider routes
router.get('/my', protect, getMyChallenges);
router.get('/challenges/my', protect, getMyChallenges);
router.get('/campaigns/my', protect, getMyChallenges);
router.get('/campaigns/challenges/my', protect, getMyChallenges);

router.post('/:id/join', protect, joinCampaign);
router.post('/:id/claim', protect, claimReward);
router.post('/campaigns/:id/join', protect, joinCampaign);
router.post('/campaigns/:id/claim', protect, claimReward);

export default router;
