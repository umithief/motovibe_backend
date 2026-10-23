import { createController } from '../../utils/controller.js';
import * as operations from './application.service.js';
export const postForgotPassword=createController(input=>operations.postForgotPassword(input));
export const postVerifyCode=createController(input=>operations.postVerifyCode(input));
export const postResetPassword=createController(input=>operations.postResetPassword(input));
export const postRefresh=createController(input=>operations.postRefresh(input));
export const postLogout=createController(input=>operations.postLogout(input));
export const getMe=createController(input=>operations.getMe(input));
