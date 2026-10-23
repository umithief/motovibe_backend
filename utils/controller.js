import catchAsync from './catchAsync.js';
import AppError from './appError.js';
import { raiseHttpError } from './httpError.js';
import { sendResponse } from './respond.js';
export const requestInput=req=>({params:req.params || {},query:req.query || {},body:req.body,
    user:req.user,file:req.file,files:req.files,headers:req.headers || {},rawBody:req.rawBody,
    ip:req.ip,socket:{remoteAddress:req.socket?.remoteAddress},method:req.method,id:req.id});
export const sendResult=(req,res,result)=>{
    if(!result || !Number.isInteger(result.statusCode))throw new AppError('Uygulama sonucu üretilemedi.',500);
    for(const [name,value]of Object.entries(result.headers || {}))res.set(name,value);
    if(result.contentType==='html')return res.status(result.statusCode).type('html').send(result.body);
    if(result.statusCode>=400)raiseHttpError(result.body,result.statusCode);
    return sendResponse(req,res,result.body,{statusCode:result.statusCode});
};
export const createController=(operation)=>catchAsync(async(req,res)=>sendResult(req,res,await operation(requestInput(req))));
