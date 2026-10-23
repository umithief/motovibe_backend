import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const exploreMapRoutes=createController(input=>operations.exploreMapRoutes(input));
export const getActiveBeacons=createController(input=>operations.getActiveBeacons(input));
export const createBeacon=createController(input=>operations.createBeacon(input));
export const updateBeaconStatus=createController(input=>operations.updateBeaconStatus(input));
export const deleteBeacon=createController(input=>operations.deleteBeacon(input));
