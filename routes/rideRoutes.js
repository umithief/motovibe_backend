import express from 'express';
import { protect, checkUser } from '../middleware/authMiddleware.js';
import { createRide, getRide, getUserRides, deleteRide } from '../controllers/rideController.js';
import { triggerSOS, updateLiveLocation } from '../controllers/sosHandler.js';
import {
    getGroupRides,
    getGroupRideById,
    createGroupRide,
    joinGroupRide,
    leaveGroupRide,
    toggleGroupLiveRadar
} from '../controllers/groupRideController.js';

const router = express.Router();

// ─── 1. Group Rides & Route Events Endpoints ─────────────────────────────────
router.route('/group-rides')
    .get(checkUser, getGroupRides)
    .post(protect, createGroupRide);

router.route('/group-rides/:id')
    .get(checkUser, getGroupRideById);

router.post('/group-rides/:id/join', protect, joinGroupRide);
router.post('/group-rides/:id/leave', protect, leaveGroupRide);
router.patch('/group-rides/:id/radar', protect, toggleGroupLiveRadar);

// ─── 2. Solo Telemetry Ride Sessions ─────────────────────────────────────────
router.route('/')
    .post(protect, createRide);

router.route('/user/:userId')
    .get(checkUser, getUserRides);

// ─── 3. Vibe-SOS Endpoints ───────────────────────────────────────────────────
router.post('/sos/trigger', protect, triggerSOS);
router.post('/sos/location', protect, updateLiveLocation);

// ─── 4. Dynamic Solo Ride ID Catch-all ────────────────────────────────────────
router.route('/:id')
    .get(checkUser, getRide)
    .delete(protect, deleteRide);

export default router;
