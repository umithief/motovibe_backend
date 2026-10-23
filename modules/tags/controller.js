import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const getTrendingTags=createController(input=>operations.getTrendingTags(input));
export const searchTags=createController(input=>operations.searchTags(input));
export const getTagDetails=createController(input=>operations.getTagDetails(input));
export const followTag=createController(input=>operations.followTag(input));
export const unfollowTag=createController(input=>operations.unfollowTag(input));
