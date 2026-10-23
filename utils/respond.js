import { serializeMediaUrls } from './serializeMediaUrls.js';
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const envelopeStatuses=new Set(['success','fail','error']);
export const responseEnvelope = (body,statusCode=200) => {
    const plain=body?.$__ && typeof body.toJSON==='function' ? body.toJSON() : body;
    if(statusCode>=400){
        const message=plain?.error?.message || plain?.message || (typeof plain?.error==='string'?plain.error:typeof plain==='string'?plain:'İstek işlenemedi.');
        const {status,data,error,meta,message:ignoredMessage,...extra}=object(plain) ? plain : {};
        return {status:'error',data:null,error:{...(object(error)?error:{}),message,...(plain?.code ? {code:plain.code} : {})},
            ...(meta || Object.keys(extra).length ? {meta:{...extra,...meta}} : {})};
    }
    if(object(plain) && Object.hasOwn(plain,'data') && (envelopeStatuses.has(plain.status) || plain.success===true)){
        const {status,success,data,meta,error,...extra}=plain;
        const metadata=Object.fromEntries(Object.entries(extra).filter(([key,value])=>!object(data) || data[key]!==value));
        return {status:'success',data:data ?? null,...(meta || Object.keys(metadata).length ? {meta:{...metadata,...meta}} : {})};
    }
    if(object(plain) && (envelopeStatuses.has(plain.status) || plain.success===true)){const {status,success,...data}=plain;return {status:'success',data};}
    return {status:'success',data:plain ?? null};
};
// Old API URLs are explicit compatibility aliases; only v2 uses the canonical envelope.
// No Express method is patched and no response is deep-cloned.
export const sendResponse = (req,res,body,{statusCode=200,legacyText=false}={}) => {
    const canonical=req?.apiVersion===2;
    const outgoing=canonical ? responseEnvelope(body,statusCode) : body;
    const outgoingStatus=canonical && statusCode===204 ? 200 : statusCode;
    res.set?.('X-API-Version',canonical ? '2' : '1');
    if(legacyText && !canonical)return res.status(outgoingStatus).send(outgoing);
    return res.status(outgoingStatus).json(serializeMediaUrls(outgoing,req));
};
export const sendSuccess = (req,res,data,{statusCode=200,meta,legacyFlat=false}={}) =>
    sendResponse(req,res,{...(legacyFlat ? data : {}),status:'success',data,...(meta ? {meta} : {})},{statusCode});
