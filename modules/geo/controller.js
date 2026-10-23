import { createController } from '../../utils/controller.js';
import * as operations from './application.service.js';
export const getNearbyPois=createController(input=>operations.getNearbyPois(input));
export const getNearbyRoadReports=createController(input=>operations.getNearbyRoadReports(input));
export const createRoadReport=createController(input=>operations.createRoadReport(input));
export const getRouteIntelligence=createController(input=>operations.getRouteIntelligence(input));
export const getProviderHealth=createController(input=>operations.getProviderHealth(input));
