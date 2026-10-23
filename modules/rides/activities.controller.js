import { sendResponse } from '../../utils/respond.js';
import catchAsync from '../../utils/catchAsync.js';
import { serializeMediaUrls } from '../../utils/serializeMediaUrls.js';
import { findLatestActivity, createLegacyActivity } from './service.js';
export const getLatestActivity=catchAsync(async (req,res)=>sendResponse(res.req,res,await findLatestActivity(req.user.id),{statusCode:200}));
export const createActivity=catchAsync(async (req,res)=>sendResponse(res.req,res,await createLegacyActivity(req.body,req.user.id),{statusCode:201}));
