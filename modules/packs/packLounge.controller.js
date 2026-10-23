import { createController } from '../../utils/controller.js';
import * as operations from './packLounge.service.js';
export const getPackLoungeMessages=createController(input=>operations.getPackLoungeMessages(input));
export const postPackLoungeMessage=createController(input=>operations.postPackLoungeMessage(input));
export const deletePackLoungeMessage=createController(input=>operations.deletePackLoungeMessage(input));
export const togglePackLoungeMute=createController(input=>operations.togglePackLoungeMute(input));
export const getPackLoungeMuteStatus=createController(input=>operations.getPackLoungeMuteStatus(input));
