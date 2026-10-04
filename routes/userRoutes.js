import express from 'express';
import rateLimit from 'express-rate-limit';
import { admin, protect, checkUser } from '../middleware/authMiddleware.js';
import * as userController from '../controllers/userController.js';
import { createLegacyRide } from '../controllers/rideController.js';

const router = express.Router();

const businessUpgradeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'İşletme hesabı geçişi için saatlik limiti doldurdunuz. Lütfen daha sonra tekrar deneyin.'
    }
});

const businessFlashLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Kampanya işlem limitine ulaştınız. Lütfen daha sonra tekrar deneyin.'
    }
});

const phoneOtpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Cok fazla dogrulama kodu istendi. Lutfen daha sonra tekrar deneyin.'
    }
});

const phoneOtpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Cok fazla dogrulama denemesi. Lutfen yeni kod isteyin.'
    }
});

// Username Validation
router.post('/check-username', protect, userController.checkUsernameAvailability);

// Auth Routes
router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);

// Onboarding (Ignition Flow)
router.post('/onboard', protect, userController.onboardUser);
router.post('/send-phone-otp', protect, phoneOtpSendLimiter, userController.sendPhoneOtp);
router.post('/request-phone-otp', protect, phoneOtpSendLimiter, userController.sendPhoneOtp);
router.post('/verify-phone', protect, phoneOtpVerifyLimiter, userController.verifyPhone);

const telemetryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        status: 'error',
        message: 'Telemetri gönderme sıklık limitine ulaştınız. Lütfen bekleyin.'
    }
});

// Profile (Me)
router.get('/', protect, admin, userController.getAllUsers);
router.get('/profile', protect, userController.getMe);
router.put('/profile', protect, userController.updateProfile);
router.delete('/profile', protect, userController.deleteMyAccount);
router.patch('/profile', protect, userController.updateProfile); // Rider Identity Config (Unified)
router.put('/profile/bio', protect, userController.updateProfile); // Bio blocks use same updateProfile logic
router.put('/update-settings', protect, userController.updateSettings);
router.patch('/update-password', protect, userController.updatePassword);
router.patch('/ghost-mode', protect, userController.toggleGhostMode); // PRO: Ghost Mode
router.patch('/telemetry', protect, telemetryLimiter, userController.saveTelemetry); // Ride Telemetry
router.post('/push-token', protect, userController.registerPushToken);
router.delete('/push-token', protect, userController.unregisterPushToken);
router.patch('/business-profile', protect, userController.updateBusinessProfile);
router.get('/business-tax-id', protect, userController.getBusinessTaxId);
router.get('/business-catalog', protect, userController.getBusinessCatalog);
router.put('/business-catalog', protect, userController.updateBusinessCatalog);
router.post('/business-catalog/items', protect, userController.createBusinessCatalogItem);
router.patch('/business-catalog/items/:itemId', protect, userController.updateBusinessCatalogItem);
router.delete('/business-catalog/items/:itemId', protect, userController.deleteBusinessCatalogItem);
router.get('/business-flash-offers', protect, userController.getBusinessFlashOffers);
router.get('/business-flash-offers/nearby', protect, userController.getNearbyBusinessFlashOffers);
router.post('/business-flash-offers', protect, businessFlashLimiter, userController.createBusinessFlashOffer);
router.patch('/business-flash-offers/:offerId/cancel', protect, userController.cancelBusinessFlashOffer);
router.patch('/profile-mode', protect, userController.updateProfileMode);
router.get('/pro/offers', protect, userController.getProOffers);
    router.post('/pro/subscribe', protect, userController.subscribeToPro);
    router.post('/pro/restore', protect, userController.restoreProSubscription);
    router.post('/upgrade-pro', protect, businessUpgradeLimiter, userController.upgradeToPro); // MotoVibe BİZ
    router.post('/downgrade-pro', protect, userController.downgradeFromPro); // MotoVibe BİZ: Kapat
    router.post('/upgrade-business', protect, businessUpgradeLimiter, userController.upgradeToBusiness);
    router.post('/downgrade-business', protect, userController.downgradeFromBusiness);
    router.post('/rides', protect, createLegacyRide); // Backward compatibility for legacy ride save payload
    router.post('/fuel-efficiency', protect, userController.calculateFuelEfficiency);
    router.get('/achievements/all', protect, userController.getAllAchievements);
    router.post('/achievements/seed', protect, admin, userController.seedAchievements);

// Cockpit Illumination (Dynamic Custom Vibe) — APEX only
router.put('/preferences/theme', protect, userController.updateThemePreference);

// Cart (Must be before /:id)
router.get('/cart', protect, userController.getCart);
router.post('/cart', protect, userController.addToCart);
router.delete('/cart/:productId', protect, userController.removeFromCart);
router.put('/cart/:productId', protect, userController.updateCartItem);

// Social Actions
router.post('/follow/:id', protect, userController.toggleFollow);
router.delete('/follow/:id', protect, userController.toggleFollow);

// Garage
router.get('/garage', protect, userController.getGarage);
router.post('/garage', protect, userController.addToGarage);
router.put('/garage/primary', protect, userController.setPrimaryBike);
router.put('/garage/:garageId', protect, userController.updateGarageItem); // Added
router.post('/garage/:garageId/verify', protect, userController.verifyGarageItem);
router.post('/garage/:garageId/maintenance', protect, userController.addMaintenanceRecord);
router.delete('/garage/:garageId/maintenance/:recordId', protect, userController.deleteMaintenanceRecord);
router.delete('/garage/:garageId', protect, userController.removeFromGarage);

// Blocking
router.get('/blocked', protect, userController.getBlockedUsers);
router.post('/block/:id', protect, userController.blockUser);
router.post('/unblock/:id', protect, userController.unblockUser);

// Verification
router.post('/verification/request', protect, userController.requestVerification);
router.post('/verification/update', protect, admin, userController.updateVerificationStatus);


// Search Users
router.get('/professionals', protect, userController.getProfessionalProfiles);
router.get('/search', protect, userController.searchUsers);
router.post('/bulk', protect, userController.getUsersByIds);

// Public User Profile (Catch-all for GET /:id)
router.get('/:id/followers', checkUser, userController.getFollowersList);
router.get('/:id/following', checkUser, userController.getFollowingList);
router.get('/:id/bio', checkUser, userController.getUserBio);
router.get('/:id', checkUser, userController.getProfile);

export default router;
