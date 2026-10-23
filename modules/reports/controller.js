import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const createReport=createController(input=>operations.createReport(input));
export const getAdminReports=createController(input=>operations.getAdminReports(input));
export const resolveReport=createController(input=>operations.resolveReport(input));
