import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const getMotoMojis=createController(input=>operations.getMotoMojis(input));
