import { createController } from '../../utils/controller.js';
import * as operations from './packPost.service.js';
export const createPackPost=createController(input=>operations.createPackPost(input));
export const getPackPosts=createController(input=>operations.getPackPosts(input));
export const togglePackPostLike=createController(input=>operations.togglePackPostLike(input));
export const addPackPostComment=createController(input=>operations.addPackPostComment(input));
export const deletePackPost=createController(input=>operations.deletePackPost(input));
export const togglePinPackPost=createController(input=>operations.togglePinPackPost(input));
