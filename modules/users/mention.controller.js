import { createController } from '../../utils/controller.js';
import * as operations from './mention.service.js';
export const mentionSearch=createController(input=>operations.mentionSearch(input));
