import { createController } from '../../utils/controller.js';
import * as operations from './groupRide.service.js';
export const getGroupRides=createController(input=>operations.getGroupRides(input));
export const getGroupRideById=createController(input=>operations.getGroupRideById(input));
export const createGroupRide=createController(input=>operations.createGroupRide(input));
export const joinGroupRide=createController(input=>operations.joinGroupRide(input));
export const leaveGroupRide=createController(input=>operations.leaveGroupRide(input));
export const toggleGroupLiveRadar=createController(input=>operations.toggleGroupLiveRadar(input));
