import { createController } from '../../utils/controller.js';
import * as operations from './application.service.js';
export const createRide=createController(input=>operations.createRide(input));
export const getRide=createController(input=>operations.getRide(input));
export const getUserRides=createController(input=>operations.getUserRides(input));
export const createLegacyRide=createController(input=>operations.createLegacyRide(input));
export const deleteRide=createController(input=>operations.deleteRide(input));
