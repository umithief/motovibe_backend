import { createController } from '../../utils/controller.js';
import * as operations from './social.service.js';
export const toggleFollow=createController(input=>operations.toggleFollow(input));
export const getFollowersList=createController(input=>operations.getFollowersList(input));
export const getFollowingList=createController(input=>operations.getFollowingList(input));
export const blockUser=createController(input=>operations.blockUser(input));
export const unblockUser=createController(input=>operations.unblockUser(input));
export const getBlockedUsers=createController(input=>operations.getBlockedUsers(input));
