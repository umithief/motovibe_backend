import AppError from './appError.js';
export const raiseHttpError = (payload,statusCode,{legacyExact=true,legacyText=false}={}) => {
    const message=typeof payload==='string' ? payload : typeof payload?.message==='string' ? payload.message : typeof payload?.error==='string' ? payload.error : payload?.error?.message || 'İstek işlenemedi.';
    const error=new AppError(message,statusCode);
    error.responseFields=payload && typeof payload==='object' ? payload : {};
    if(legacyExact)error.legacyExactPayload=payload;
    if(legacyText)error.legacyText=true;
    if(typeof payload?.code==='string')error.code=payload.code;
    throw error;
};
