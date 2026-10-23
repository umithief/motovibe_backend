import { createController } from '../../utils/controller.js';
import * as operations from './application.service.js';
export const initializeBusinessCheckout=createController(input=>operations.initializeBusinessCheckout(input));
export const handleIyzicoCallback=createController(input=>operations.handleIyzicoCallback(input));
export const handleIyzicoWebhook=createController(input=>operations.handleIyzicoWebhook(input));
export const getBusinessCommerceSummary=createController(input=>operations.getBusinessCommerceSummary(input));
export const getBusinessSettlements=createController(input=>operations.getBusinessSettlements(input));
