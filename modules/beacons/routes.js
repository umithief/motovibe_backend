import express from 'express';
import { protect } from "../../middleware/authMiddleware.js";
import {
    getActiveBeacons,
    createBeacon,
    updateBeaconStatus,
    deleteBeacon
} from "./controller.js";

const router = express.Router();

router.route('/')
    .post(protect, createBeacon);

router.post('/trigger', protect, createBeacon);

router.route('/active')
    .get(getActiveBeacons);

router.route('/:id')
    .patch(protect, updateBeaconStatus)
    .delete(protect, deleteBeacon);

export default router;
