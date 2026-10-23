import express from 'express';
import { protect, admin } from "../../middleware/authMiddleware.js";
import {
    getAllUsers, deleteUser, updateUserRole,
    getAllPosts, deletePost,
    getAllRoutes, deleteRoute,
    getAllPacks, deletePack,
    getAdminStats,
    getPendingGarageVerifications,
    verifyUserBike,
    getControlPanel,
    updateControlPanel,
    executeControlPanelAction
} from "./controller.js";
import {
    adminGetCampaigns,
    adminCreateCampaign,
    adminUpdateCampaign,
    adminDeleteCampaign,
} from "../campaigns/controller.js";

const router = express.Router();

// T\u00fcm admin API'leri i\u00e7in yetki do\u011frulamas\u0131 (Sadece Admin)
router.use(protect, admin);

router.route('/stats').get(getAdminStats);

router.route('/users')
    .get(getAllUsers);

router.route('/users/:id')
    .delete(deleteUser)
    .put(updateUserRole);

router.route('/posts')
    .get(getAllPosts);

router.route('/posts/:id')
    .delete(deletePost);

router.route('/routes')
    .get(getAllRoutes);

router.route('/routes/:id')
    .delete(deleteRoute);

router.route('/packs')
    .get(getAllPacks);

router.route('/packs/:id')
    .delete(deletePack);

// Campaign management
router.route('/campaigns')
    .get(adminGetCampaigns)
    .post(adminCreateCampaign);

// Garage verification management
router.route('/garage/verifications')
    .get(getPendingGarageVerifications);

router.route('/garage/verifications/:userId/:garageId/verify')
    .post(verifyUserBike);

router.route('/campaigns/:id')
    .put(adminUpdateCampaign)
    .delete(adminDeleteCampaign);

// System Control Panel (Kontrol Paneli)
router.route('/control-panel')
    .get(getControlPanel)
    .put(updateControlPanel);

router.route('/control-panel/action')
    .post(executeControlPanelAction);

export default router;
