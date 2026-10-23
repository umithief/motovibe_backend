import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';

import { raiseHttpError } from '../../utils/httpError.js';

import BusinessSettlement from "./BusinessSettlement.model.js";
import Appointment from "../appointments/model.js";
import User from "../users/model.js";
import AppError from "../../utils/appError.js";

import {
    businessCommissionRate,
    isBusinessCommerceEnabled
} from "./service.js";
import {
    buildCheckoutRequest,
    initializeIyzicoCheckout,
    isBusinessCheckoutEnabled,
    retrieveIyzicoCheckout,
    verifyCheckoutResultSignature,
    verifyIyzicoWebhookSignature
} from "./iyzicoCheckoutService.service.js";

const normalizeBilling = (body = {}) => ({
    identityNumber: String(body.identityNumber || '').replace(/\D/g, ''),
    phone: String(body.phone || '').trim(),
    address: String(body.address || '').trim(),
    city: String(body.city || '').trim(),
    zipCode: String(body.zipCode || '').replace(/\s/g, '')
});

const validBilling = (billing) =>
    /^\d{11}$/.test(billing.identityNumber) &&
    /^\+?[0-9]{10,15}$/.test(billing.phone.replace(/[\s()-]/g, '')) &&
    billing.address.length >= 10 && billing.address.length <= 240 &&
    billing.city.length >= 2 && billing.city.length <= 60 &&
    /^[0-9A-Za-z-]{3,12}$/.test(billing.zipCode);

const callbackBaseUrl = () => String(
    process.env.IYZIPAY_CALLBACK_BASE_URL ||
    process.env.IYZICO_CALLBACK_BASE_URL ||
    process.env.BASE_URL ||
    ''
).replace(/\/+$/, '');

const reconcileIyzicoCheckout = async (token) => {
    const settlement = await BusinessSettlement.findOne({ paymentToken: token })
        .select('+paymentToken +paymentConversationId +externalPaymentId +checkoutExpiresAt');
    if (!settlement) return { success: false, settlementNumber: '' };
    const result = await retrieveIyzicoCheckout({
        token,
        conversationId: settlement.paymentConversationId
    });
    const success = result?.status === 'success' &&
        result?.paymentStatus === 'SUCCESS' &&
        String(result?.conversationId) === String(settlement._id) &&
        String(result?.basketId) === settlement.settlementNumber &&
        Number(result?.paidPrice) === Number(settlement.grossAmount) &&
        verifyCheckoutResultSignature(result);
    if (success && settlement.status === 'pending') {
        settlement.status = 'paid';
        settlement.paidAt = new Date();
        settlement.externalPaymentId = String(result.paymentId);
        settlement.paymentToken = undefined;
        settlement.checkoutExpiresAt = undefined;
        await settlement.save();
    }
    return { success, settlementNumber: settlement.settlementNumber };
};

export const initializeBusinessCheckout = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    if (!isBusinessCheckoutEnabled()) {
        return throwError(new AppError('BİZ ödemeleri henüz kullanıma açık değil.', 503));
    }
    const callbackBase = callbackBaseUrl();
    const callbackIsValid = /^https?:\/\//.test(callbackBase) &&
        (process.env.NODE_ENV !== 'production' || callbackBase.startsWith('https://'));
    if (!callbackIsValid) {
        return throwError(new AppError('Ödeme geri dönüş adresi yapılandırılmamış.', 503));
    }
    const billing = normalizeBilling(input.body);
    if (!validBilling(billing)) {
        return throwError(new AppError(
            'Fatura bilgilerini, 11 haneli kimlik numarasını ve telefonu kontrol et.',
            400
        ));
    }
    const appointment = await Appointment.findOne({
        _id: input.body.appointmentId,
        customerId: input.user.id,
        status: 'completed'
    });
    if (!appointment) {
        return throwError(new AppError('Ödenebilir tamamlanmış randevu bulunamadı.', 404));
    }
    const [settlement, customer, business] = await Promise.all([
        BusinessSettlement.findOne({ appointmentId: appointment._id })
            .select('+paymentToken +paymentConversationId +checkoutExpiresAt'),
        User.findById(input.user.id).select('name email'),
        User.findById(appointment.businessId)
            .select('userType businessProfile.businessName +businessProfile.iyzicoSubMerchantKey')
    ]);
    if (!settlement || settlement.status !== 'pending') {
        return throwError(new AppError('Bu randevu için bekleyen ödeme kaydı bulunamadı.', 409));
    }
    if (!customer || !business || business.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Ödeme tarafları doğrulanamadı.', 409));
    }
    const request = buildCheckoutRequest({
        settlement,
        customer,
        business,
        billing: {
            ...billing,
            phone: billing.phone.replace(/[\s()-]/g, '')
        },
        callbackUrl: `${callbackBase}/api/business-commerce/iyzico/callback`,
        ipAddress: input.ip || input.socket?.remoteAddress || '127.0.0.1'
    });
    const result = await initializeIyzicoCheckout(request);
    if (result?.status !== 'success' || !result.token || !result.paymentPageUrl) {
        return throwError(new AppError(
            result?.errorMessage || 'Ödeme sayfası başlatılamadı.',
            502
        ));
    }
    settlement.paymentProvider = 'iyzico';
    settlement.paymentToken = result.token;
    settlement.paymentConversationId = result.conversationId;
    settlement.checkoutExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await settlement.save();
    respond({
        status: 'success',
        data: {
            checkoutUrl: result.paymentPageUrl,
            settlementNumber: settlement.settlementNumber,
            expiresAt: settlement.checkoutExpiresAt
        }
    },201);

    return response;
};

export const handleIyzicoCallback = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const token = String(input.body?.token || input.query?.token || '').trim();
    let success = false;
    let settlementNumber = '';
    if (token && isBusinessCheckoutEnabled()) {
        ({ success, settlementNumber } = await reconcileIyzicoCheckout(token));
    }
    const title = success ? 'Ödeme tamamlandı' : 'Ödeme doğrulanamadı';
    const detail = success
        ? `${settlementNumber} numaralı işlem güvenle kaydedildi. MotoVibe'a dönebilirsin.`
        : 'İşlem tamamlanmadı. Uygulamaya dönüp ödeme durumunu yenileyebilirsin.';
    respond(`<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="margin:0;background:#101310;color:#f4f7ef;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:32px"><h1>${title}</h1><p>${detail}</p></main></body></html>`,success ? 200 : 400,{contentType:'html'});

    return response;
};

export const handleIyzicoWebhook = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const signature = readHeader(input.headers,'x-iyz-signature-v3');
    if (!verifyIyzicoWebhookSignature(input.body, signature)) {
        return raiseHttpError({ status: 'fail' },401);
    }
    const token = String(input.body?.token || '').trim();
    if (token && isBusinessCheckoutEnabled()) {
        await reconcileIyzicoCheckout(token);
    }
    respond({ status: 'success' },200);

    return response;
};

export const getBusinessCommerceSummary = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const user = await User.findById(input.user.id).select('userType');
    if (!user || user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('BİZ finans özeti için işletme hesabı gerekir.', 403));
    }
    const periodDays = Math.min(Math.max(parseInt(input.query.days, 10) || 30, 7), 365);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const rows = await BusinessSettlement.aggregate([
        { $match: { businessId: user._id, createdAt: { $gte: since } } },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                grossAmount: { $sum: '$grossAmount' },
                commissionAmount: { $sum: '$commissionAmount' },
                netAmount: { $sum: '$netAmount' }
            }
        }
    ]);
    const totals = rows.reduce(
        (result, row) => {
            result.count += row.count;
            result.grossAmount += row.grossAmount;
            result.commissionAmount += row.commissionAmount;
            result.netAmount += row.netAmount;
            result.byStatus[row._id] = row.count;
            return result;
        },
        { count: 0, grossAmount: 0, commissionAmount: 0, netAmount: 0, byStatus: {} }
    );
    respond({
        status: 'success',
        data: {
            enabled: isBusinessCommerceEnabled(),
            checkoutEnabled: isBusinessCheckoutEnabled(),
            periodDays,
            currency: 'TRY',
            commissionRate: businessCommissionRate(),
            ...totals
        }
    },200);

    return response;
};

export const getBusinessSettlements = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    const role = String(input.query.role || 'business').toLowerCase();
    if (!['business', 'customer'].includes(role)) {
        return throwError(new AppError('Finans kayıt rolü geçersiz.', 400));
    }
    const page = Math.max(parseInt(input.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(input.query.limit, 10) || 20, 1), 50);
    const filter = role === 'business'
        ? { businessId: input.user.id }
        : { customerId: input.user.id };
    if (role === 'business') {
        const user = await User.findById(input.user.id).select('userType');
        if (!user || user.userType !== 'PROFESSIONAL') {
            return throwError(new AppError('İşletme finans kayıtları için BİZ hesabı gerekir.', 403));
        }
    }
    const [settlements, total] = await Promise.all([
        BusinessSettlement.find(filter)
            .select('-externalPaymentId')
            .populate('businessId', 'name businessProfile.businessName')
            .populate('customerId', 'name username avatar')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        BusinessSettlement.countDocuments(filter)
    ]);
    respond({
        status: 'success',
        results: settlements.length,
        data: { settlements, page, hasMore: page * limit < total }
    },200);

    return response;
};
