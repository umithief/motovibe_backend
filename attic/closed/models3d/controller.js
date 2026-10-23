import { createController } from "../../../utils/controller.js";
import * as operations from "./service.js";
export const get=createController(input=>operations.get(input));
export const post=createController(input=>operations.post(input));
export const deleteId=createController(input=>operations.deleteId(input));
