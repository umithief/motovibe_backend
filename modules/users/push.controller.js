import { createController } from '../../utils/controller.js';
import * as operations from './push.service.js';
export const registerPushToken=createController(input=>operations.registerPushToken(input));
export const unregisterPushToken=createController(input=>operations.unregisterPushToken(input));
