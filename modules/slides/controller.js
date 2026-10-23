import { createController } from '../../utils/controller.js';
import * as operations from './service.js';
export const get=createController(input=>operations.get(input));
export const putReorder=createController(input=>operations.putReorder(input));
export const post=createController(input=>operations.post(input));
export const putId=createController(input=>operations.putId(input));
export const deleteId=createController(input=>operations.deleteId(input));
