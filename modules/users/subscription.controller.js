import { createController } from '../../utils/controller.js';
import * as operations from './subscription.service.js';
export const getProOffers=createController(input=>operations.getProOffers(input));
export const subscribeToPro=createController(input=>operations.subscribeToPro(input));
export const restoreProSubscription=createController(input=>operations.restoreProSubscription(input));
