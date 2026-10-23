import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const getBusinessAppointments=createController(input=>operations.getBusinessAppointments(input));
export const bookAppointment=createController(input=>operations.bookAppointment(input));
export const getAppointmentAvailability=createController(input=>operations.getAppointmentAvailability(input));
export const updateAppointmentStatus=createController(input=>operations.updateAppointmentStatus(input));
export { ACTIVE_APPOINTMENT_STATUSES, BUSINESS_TIME_ZONE, appointmentFitsWorkingHours, businessClock, businessInstant, isAppointmentTransitionAllowed, resolveAppointmentService, withBusinessBookingLock } from "./service.js";
