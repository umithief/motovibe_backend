import { createController } from '../../utils/controller.js';
import * as operations from './application.service.js';
export const universalSearch=createController(input=>operations.universalSearch(input));
export const getTrending=createController(input=>operations.getTrending(input));
