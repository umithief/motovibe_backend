import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    getRoutes,
    getMyRoutes,
    getRouteById,
    createRoute,
    updateRouteDetails,
    deleteRoute,
    recordRouteRide,
    seedRoutes,
    generateApexRoute,
    saveRoute,
    addReview,
    editReview,
    deleteReview
} from '../controllers/routeController.js';
import { getRouteIntelligence } from '../controllers/geoController.js';
import { exploreMapRoutes } from '../controllers/mapController.js';
import { protect, admin, checkUser } from '../middleware/authMiddleware.js';

const router = express.Router();

const apexRouteGenerationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        status: 'error',
        message: 'Cok fazla Apex rota istegi gonderildi. Lutfen biraz bekleyin.'
    },
    validate: { xForwardedForHeader: false }
});

const routeIntelligenceLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { status: 'error', message: 'Cok fazla rota zekasi istegi gonderildi. Lutfen biraz bekleyin.' },
    validate: { xForwardedForHeader: false }
});

// Geospatial explore
router.route('/explore').get(exploreMapRoutes);

router.route('/')
    .get(checkUser, getRoutes)
    .post(protect, createRoute);

router.route('/seed')
    .post(protect, admin, seedRoutes);

router.route('/generate-apex')
    .post(protect, apexRouteGenerationLimiter, generateApexRoute);

router.route('/intelligence')
    .post(protect, routeIntelligenceLimiter, getRouteIntelligence);

router.route('/my')
    .get(protect, getMyRoutes);

// Grouping by ID
router.route('/:id')
    .get(checkUser, getRouteById)
    .patch(protect, updateRouteDetails)
    .delete(protect, deleteRoute);

router.route('/:id/ride')
    .post(protect, recordRouteRide);

router.route('/:id/save')
    .post(protect, saveRoute);

router.route('/:id/reviews')
    .post(protect, addReview);

router.route('/:id/reviews/:reviewId')
    .patch(protect, editReview)
    .delete(protect, deleteReview);

export default router;
