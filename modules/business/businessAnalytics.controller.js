import { createController } from '../../utils/controller.js';
import * as operations from './businessAnalytics.service.js';
export const recordBusinessAnalyticsEvent=createController(input=>operations.recordBusinessAnalyticsEvent(input));
export const getBusinessAnalyticsDashboard=createController(input=>operations.getBusinessAnalyticsDashboard(input));
export { calculateBusinessFunnelMetrics } from "./businessAnalytics.service.js";
