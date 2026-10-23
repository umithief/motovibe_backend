// Application results contain data and transport hints, never Express request/response objects.
export const serviceResult=(body,statusCode=200,options={})=>({body,statusCode,...options});
export const throwError=error=>{throw error;};
export const readHeader=(headers,name)=>headers?.[String(name).toLowerCase()];
