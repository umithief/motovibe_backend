import catchAsync from '../../utils/catchAsync.js';
import { requestInput,sendResult } from '../../utils/controller.js';
import { createProfileThemeServices } from './profileTheme.service.js';
export function createProfileThemeHandlers(dependencies){
    const operations=createProfileThemeServices(dependencies);
    return Object.fromEntries(Object.entries(operations).map(([name,operation])=>[name,async(req,res,next)=>{
        try {return sendResult(req,res,await operation(requestInput(req)));}catch(error){return next(error);}
    }]));
}
const handlers=createProfileThemeHandlers();
export const getProfileThemeCatalog=catchAsync(handlers.catalog);
export const getProfileThemeDetail=catchAsync(handlers.detail);
export const updateProfileTheme=catchAsync(handlers.update);
export const resetProfileTheme=catchAsync(handlers.reset);
