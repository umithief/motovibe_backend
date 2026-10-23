import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const handleRevenueCatWebhook=createController(input=>operations.handleRevenueCatWebhook(input));
export { parseRevenueCatSignature, verifyRevenueCatSignature, revenueCatUpdateForEvent } from "./service.js";
