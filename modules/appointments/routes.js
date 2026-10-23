import { rateLimitError } from '../../middleware/rateLimitError.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect } from "../../middleware/authMiddleware.js";
import * as appointmentController from "./controller.js";

const router = express.Router();

const appointmentCreateLimiter = rateLimit({
    handler:rateLimitError,
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
        status: 'error',
        message: 'Kısa sürede çok fazla randevu talebi oluşturdunuz. Lütfen biraz sonra tekrar deneyin.'
    }
});

router.use(protect);

router.get('/availability', appointmentController.getAppointmentAvailability);

router.route('/')
    .get(appointmentController.getBusinessAppointments)
    .post(appointmentCreateLimiter, appointmentController.bookAppointment);

router.route('/:id')
    .patch(appointmentController.updateAppointmentStatus);

export default router;
