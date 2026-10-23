import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const getBranding=createController(input=>operations.getBranding(input));
export const updateBranding=createController(input=>operations.updateBranding(input));
export const getSettings=createController(input=>operations.getSettings(input));
export const updateSettings=createController(input=>operations.updateSettings(input));
