import { createController } from '../../utils/controller.js';
import * as operations from './sos.service.js';
export const triggerSOS=createController(input=>operations.triggerSOS(input));
export const updateLiveLocation=createController(input=>operations.updateLiveLocation(input));
