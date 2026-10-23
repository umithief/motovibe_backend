import { createController } from '../../utils/controller.js';
import * as operations from './businessReview.service.js';
export const getBusinessReviews=createController(input=>operations.getBusinessReviews(input));
export const upsertBusinessReview=createController(input=>operations.upsertBusinessReview(input));
export const deleteBusinessReview=createController(input=>operations.deleteBusinessReview(input));
