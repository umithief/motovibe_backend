import { createController } from '../../utils/controller.js';
import * as operations from './achievements.service.js';
export const seedAchievements=createController(input=>operations.seedAchievements(input));
export const getAllAchievements=createController(input=>operations.getAllAchievements(input));
