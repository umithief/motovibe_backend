import { sendResponse } from '../../utils/respond.js';
import catchAsync from '../../utils/catchAsync.js';
import { serializeMediaUrls } from '../../utils/serializeMediaUrls.js';
import { buildDiscoveryPage } from './feed.service.js';
export const getDiscoveryFeed = catchAsync(async (req,res) => {
    sendResponse(res.req,res,await buildDiscoveryPage({userId:req.user?._id?.toString(),query:req.query}),{statusCode:200});
});
export const getExplorePosts = catchAsync(async (req,res) => {
    sendResponse(res.req,res,await buildDiscoveryPage({userId:req.user?._id?.toString(),query:req.query,postsOnly:true}),{statusCode:200});
});
export const getExploreFeed = catchAsync(async (req,res) => {
    const response=await buildDiscoveryPage({userId:req.user?._id?.toString(),query:req.query});
    sendResponse(res.req,res,{status:response.status,data:{items:response.data.items},items:response.data.items},{statusCode:200});
});

import { createController } from '../../utils/controller.js';
import * as settings from './settings.service.js';
export const getVibeSettings=createController(input=>settings.getVibeSettings(input));
export const updateVibeSettings=createController(input=>settings.updateVibeSettings(input));
