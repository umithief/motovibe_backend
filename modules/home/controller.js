import catchAsync from '../../utils/catchAsync.js';
import { sendSuccess } from '../../utils/respond.js';
import { buildHomeSummary } from './service.js';
export const getHomeSummary=catchAsync(async(req,res)=>{
    const summary=await buildHomeSummary({user:req.user});
    res.set('Cache-Control','private, no-store');
    sendSuccess(req,res,summary,{legacyFlat:true});
});
