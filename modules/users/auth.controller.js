import { createController } from '../../utils/controller.js';
import * as operations from './auth.service.js';
export const registerUser=createController(input=>operations.registerUser(input));
export const loginUser=createController(input=>operations.loginUser(input));
export const updatePassword=createController(input=>operations.updatePassword(input));
export const sendPhoneOtp=createController(input=>operations.sendPhoneOtp(input));
export const verifyPhone=createController(input=>operations.verifyPhone(input));
export const deleteMyAccount=createController(input=>operations.deleteMyAccount(input));
