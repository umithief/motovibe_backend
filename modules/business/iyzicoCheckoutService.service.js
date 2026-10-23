import crypto from 'crypto';

const providerConfig = () => ({
    apiKey: String(process.env.IYZIPAY_API_KEY || '').trim(),
    secretKey: String(process.env.IYZIPAY_SECRET_KEY || '').trim(),
    uri: String(
        process.env.IYZIPAY_URI || 'https://sandbox-api.iyzipay.com'
    ).replace(/\/+$/, '')
});

export const isIyzicoConfigured = () => {
    const config = providerConfig();
    return Boolean(config.apiKey && config.secretKey && config.uri);
};

export const isBusinessCheckoutEnabled = () =>
    String(process.env.BIZ_COMMERCE_ENABLED || '').toLowerCase() === 'true' &&
    isIyzicoConfigured();

const fixedPrice = (value) => Number(value).toFixed(2);

const iyzicoRequest = async (path, body) => {
    const config = providerConfig();
    if (!isIyzicoConfigured()) {
        throw new Error('iyzico credentials are not configured');
    }
    const randomKey = crypto.randomBytes(16).toString('hex');
    const signature = crypto
        .createHmac('sha256', config.secretKey)
        .update(`${randomKey}${path}${JSON.stringify(body)}`)
        .digest('hex');
    const authorizationPayload = [
        `apiKey:${config.apiKey}`,
        `randomKey:${randomKey}`,
        `signature:${signature}`
    ].join('&');
    const response = await fetch(`${config.uri}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `IYZWSv2 ${Buffer.from(authorizationPayload).toString('base64')}`,
            'Content-Type': 'application/json',
            'x-iyzi-rnd': randomKey,
            'x-iyzi-client-version': 'motovibe-node-1.0'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
    });
    const raw = await response.text();
    let result;
    try {
        result = JSON.parse(raw);
    } catch {
        throw new Error(`iyzico returned an invalid response (${response.status})`);
    }
    if (!response.ok && !result?.errorMessage) {
        throw new Error(`iyzico request failed (${response.status})`);
    }
    return result;
};

export const buildCheckoutRequest = ({
    settlement,
    customer,
    business,
    billing,
    callbackUrl,
    ipAddress
}) => {
    const fullName = String(customer.name || '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const name = parts.shift() || 'MotoVibe';
    const surname = parts.join(' ') || 'Kullanıcısı';
    const contactName = `${name} ${surname}`.trim();
    const price = fixedPrice(settlement.grossAmount);
    const basketItem = {
        id: String(settlement.catalogItemId),
        name: String(settlement.itemName).slice(0, 80),
        category1: 'MotoVibe BİZ',
        itemType: 'VIRTUAL',
        price
    };
    const subMerchantKey = String(
        business.businessProfile?.iyzicoSubMerchantKey || ''
    ).trim();
    if (subMerchantKey) {
        basketItem.subMerchantKey = subMerchantKey;
        basketItem.subMerchantPrice = fixedPrice(settlement.netAmount);
    }
    const address = {
        contactName,
        city: billing.city,
        country: 'Turkey',
        address: billing.address,
        zipCode: billing.zipCode
    };
    return {
        locale: 'tr',
        conversationId: String(settlement._id),
        price,
        paidPrice: price,
        currency: 'TRY',
        basketId: String(settlement.settlementNumber),
        paymentGroup: subMerchantKey
            ? 'LISTING'
            : 'PRODUCT',
        callbackUrl,
        enabledInstallments: [2, 3, 6, 9],
        buyer: {
            id: String(customer._id),
            name,
            surname,
            gsmNumber: billing.phone,
            email: customer.email,
            identityNumber: billing.identityNumber,
            registrationAddress: billing.address,
            ip: ipAddress,
            city: billing.city,
            country: 'Turkey',
            zipCode: billing.zipCode
        },
        shippingAddress: address,
        billingAddress: address,
        basketItems: [basketItem]
    };
};

export const initializeIyzicoCheckout = async (request) => {
    return iyzicoRequest(
        '/payment/iyzipos/checkoutform/initialize/auth/ecom',
        request
    );
};

export const retrieveIyzicoCheckout = async ({ token, conversationId }) => {
    return iyzicoRequest(
        '/payment/iyzipos/checkoutform/auth/ecom/detail',
        { locale: 'tr', token, conversationId }
    );
};

export const verifyCheckoutResultSignature = (result) => {
    if (!result?.signature || !isIyzicoConfigured()) return false;
    const payload = [
        result.paymentStatus,
        result.paymentId,
        result.currency,
        result.basketId,
        result.conversationId,
        result.paidPrice,
        result.price,
        result.token
    ].join(':');
    const calculated = crypto
        .createHmac('sha256', providerConfig().secretKey)
        .update(payload)
        .digest('hex');
    const expected = Buffer.from(calculated);
    const received = Buffer.from(String(result.signature));
    return expected.length === received.length &&
        crypto.timingSafeEqual(expected, received);
};

export const verifyIyzicoWebhookSignature = (payload, signature) => {
    if (!signature || !isIyzicoConfigured()) return false;
    const data = [
        payload?.iyziEventType,
        payload?.iyziPaymentId,
        payload?.token,
        payload?.paymentConversationId,
        payload?.status
    ].map((value) => String(value || '')).join('');
    const calculated = crypto
        .createHmac('sha256', providerConfig().secretKey)
        .update(data)
        .digest('hex');
    const expected = Buffer.from(calculated);
    const received = Buffer.from(String(signature));
    return expected.length === received.length &&
        crypto.timingSafeEqual(expected, received);
};
