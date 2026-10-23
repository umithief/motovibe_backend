import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const postVisit=createController(input=>operations.postVisit(input));
export const getVisitors=createController(input=>operations.getVisitors(input));
export const postEvent=createController(input=>operations.postEvent(input));
export const getDashboard=createController(input=>operations.getDashboard(input));
