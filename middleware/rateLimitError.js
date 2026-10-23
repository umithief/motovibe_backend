import catchAsync from '../utils/catchAsync.js';
import { raiseHttpError } from '../utils/httpError.js';
// express-rate-limit supplies its resolved options as the fourth argument.
export const rateLimitError=(req,res,next,options)=>catchAsync(async()=>{
    const payload=typeof options.message==='function'?await options.message(req,res):options.message;
    raiseHttpError(payload,options.statusCode,{legacyExact:true,legacyText:typeof payload==='string'});
})(req,res,next);
