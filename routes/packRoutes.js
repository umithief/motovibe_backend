import express from 'express';
import {
    createPack, 
    getPackDetails, 
    getPackLeaderboard,
    getLiveRiders, 
    getAllPacks, 
    joinPack, 
    leavePack,
    updatePack,
    kickMember,
    getPackSignals,
    createPackSignal,
    approveJoinRequest,
    rejectJoinRequest,
    updateMemberRole,
    migratePackMemberRoles,
    deletePack,
    createPackRide,
    updatePackRide,
    deletePackRide,
    toggleRideAttendance,
} from '../controllers/packController.js';
import {
    addPackPostComment,
    createPackPost,
    deletePackPost,
    getPackPosts,
    togglePackPostLike,
    togglePinPackPost,
} from '../controllers/packPostController.js';
import {
    getPackLoungeMessages,
    postPackLoungeMessage,
    deletePackLoungeMessage,
    togglePackLoungeMute,
    getPackLoungeMuteStatus,
} from '../controllers/packLoungeController.js';

import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getAllPacks);
router.post('/create', protect, createPack);
router.get('/leaderboard', protect, getPackLeaderboard);
router.get('/:packId', protect, getPackDetails);
router.put('/:packId', protect, updatePack);
router.get('/:packId/live-riders', protect, getLiveRiders);
router.post('/:packId/join', protect, joinPack);
router.post('/:packId/leave', protect, leavePack);
router.post('/:packId/migrate-roles', protect, migratePackMemberRoles);

// Rides routes
router.post('/:packId/rides', protect, createPackRide);
router.put('/:packId/rides/:rideId', protect, updatePackRide);
router.delete('/:packId/rides/:rideId', protect, deletePackRide);
router.post('/:packId/rides/:rideId/attendance', protect, toggleRideAttendance);

// Members management routes
router.delete('/:packId/members/:userId', protect, kickMember);
router.put('/:packId/members/:userId/approve', protect, approveJoinRequest);
router.put('/:packId/members/:userId/reject', protect, rejectJoinRequest);
router.put('/:packId/members/:userId/role', protect, updateMemberRole);

// Signals routes
router.get('/:packId/signals', protect, getPackSignals);
router.post('/:packId/signals', protect, createPackSignal);

// Lounge routes
router.get('/:packId/lounge/messages', protect, getPackLoungeMessages);
router.post('/:packId/lounge/messages', protect, postPackLoungeMessage);
router.delete('/:packId/lounge/messages/:messageId', protect, deletePackLoungeMessage);
router.get('/:packId/lounge/mute', protect, getPackLoungeMuteStatus);
router.post('/:packId/lounge/mute', protect, togglePackLoungeMute);

// Posts routes
router.get('/:packId/posts', protect, getPackPosts);
router.post('/:packId/posts', protect, createPackPost);
router.post('/:packId/posts/:postId/like', protect, togglePackPostLike);
router.post('/:packId/posts/:postId/comment', protect, addPackPostComment);
router.post('/:packId/posts/:postId/pin', protect, togglePinPackPost);
router.delete('/:packId/posts/:postId', protect, deletePackPost);

// Delete pack route
router.delete('/:packId', protect, deletePack);

export default router;
