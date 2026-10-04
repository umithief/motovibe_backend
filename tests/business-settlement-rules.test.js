import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateSettlementAmounts } from '../services/businessSettlementService.js';
import {
    buildCheckoutRequest,
    isBusinessCheckoutEnabled,
    verifyCheckoutResultSignature,
    verifyIyzicoWebhookSignature
} from '../services/iyzicoCheckoutService.js';
import crypto from 'node:crypto';

test('business settlement calculates server-side commission and net amount', () => {
    assert.deepEqual(calculateSettlementAmounts(1000, 8), {
        grossAmount: 1000,
        commissionRate: 8,
        commissionAmount: 80,
        netAmount: 920
    });
    assert.deepEqual(calculateSettlementAmounts(199.99, 7.5), {
        grossAmount: 199.99,
        commissionRate: 7.5,
        commissionAmount: 15,
        netAmount: 184.99
    });
});

test('business settlement clamps invalid amounts and commission policy', () => {
    assert.deepEqual(calculateSettlementAmounts(-20, 80), {
        grossAmount: 0,
        commissionRate: 30,
        commissionAmount: 0,
        netAmount: 0
    });
});

test('iyzico checkout remains disabled without both commerce flag and credentials', () => {
    const before = {
        enabled: process.env.BIZ_COMMERCE_ENABLED,
        key: process.env.IYZIPAY_API_KEY,
        secret: process.env.IYZIPAY_SECRET_KEY
    };
    process.env.BIZ_COMMERCE_ENABLED = 'true';
    delete process.env.IYZIPAY_API_KEY;
    delete process.env.IYZIPAY_SECRET_KEY;
    assert.equal(isBusinessCheckoutEnabled(), false);
    if (before.enabled === undefined) delete process.env.BIZ_COMMERCE_ENABLED;
    else process.env.BIZ_COMMERCE_ENABLED = before.enabled;
    if (before.key === undefined) delete process.env.IYZIPAY_API_KEY;
    else process.env.IYZIPAY_API_KEY = before.key;
    if (before.secret === undefined) delete process.env.IYZIPAY_SECRET_KEY;
    else process.env.IYZIPAY_SECRET_KEY = before.secret;
});

test('iyzico request uses server settlement amounts and marketplace net share', () => {
    const request = buildCheckoutRequest({
        settlement: {
            _id: 'settlement-id',
            settlementNumber: 'MV-2026-0001',
            catalogItemId: 'catalog-id',
            itemName: 'Zincir Bakımı',
            grossAmount: 1000,
            netAmount: 920
        },
        customer: {
            _id: 'customer-id',
            name: 'Ada Sürücü',
            email: 'ada@example.com'
        },
        business: {
            businessProfile: { iyzicoSubMerchantKey: 'sub-key' }
        },
        billing: {
            identityNumber: '11111111111',
            phone: '+905551112233',
            address: 'Kadıköy örnek adres no 1',
            city: 'İstanbul',
            zipCode: '34710'
        },
        callbackUrl: 'https://api.example.com/callback',
        ipAddress: '127.0.0.1'
    });
    assert.equal(request.price, '1000.00');
    assert.equal(request.paidPrice, '1000.00');
    assert.equal(request.basketItems[0].price, '1000.00');
    assert.equal(request.basketItems[0].subMerchantPrice, '920.00');
    assert.equal(request.basketItems[0].subMerchantKey, 'sub-key');
});

test('iyzico result signature must match every reconciled payment field', () => {
    const before = {
        key: process.env.IYZIPAY_API_KEY,
        secret: process.env.IYZIPAY_SECRET_KEY
    };
    process.env.IYZIPAY_API_KEY = 'sandbox-key';
    process.env.IYZIPAY_SECRET_KEY = 'sandbox-secret';
    const result = {
        paymentStatus: 'SUCCESS',
        paymentId: 'payment-id',
        currency: 'TRY',
        basketId: 'MV-2026-0001',
        conversationId: 'settlement-id',
        paidPrice: '1000.00',
        price: '1000.00',
        token: 'checkout-token'
    };
    result.signature = crypto
        .createHmac('sha256', process.env.IYZIPAY_SECRET_KEY)
        .update(Object.values(result).join(':'))
        .digest('hex');
    assert.equal(verifyCheckoutResultSignature(result), true);
    assert.equal(
        verifyCheckoutResultSignature({ ...result, paidPrice: '1.00' }),
        false
    );
    if (before.key === undefined) delete process.env.IYZIPAY_API_KEY;
    else process.env.IYZIPAY_API_KEY = before.key;
    if (before.secret === undefined) delete process.env.IYZIPAY_SECRET_KEY;
    else process.env.IYZIPAY_SECRET_KEY = before.secret;
});

test('iyzico webhook signature rejects tampered provider events', () => {
    const before = {
        key: process.env.IYZIPAY_API_KEY,
        secret: process.env.IYZIPAY_SECRET_KEY
    };
    process.env.IYZIPAY_API_KEY = 'sandbox-key';
    process.env.IYZIPAY_SECRET_KEY = 'sandbox-secret';
    const payload = {
        iyziEventType: 'CHECKOUT_FORM_AUTH',
        iyziPaymentId: 'payment-id',
        token: 'checkout-token',
        paymentConversationId: 'settlement-id',
        status: 'SUCCESS'
    };
    const signature = crypto
        .createHmac('sha256', process.env.IYZIPAY_SECRET_KEY)
        .update(Object.values(payload).join(''))
        .digest('hex');
    assert.equal(verifyIyzicoWebhookSignature(payload, signature), true);
    assert.equal(
        verifyIyzicoWebhookSignature({ ...payload, status: 'FAILURE' }, signature),
        false
    );
    if (before.key === undefined) delete process.env.IYZIPAY_API_KEY;
    else process.env.IYZIPAY_API_KEY = before.key;
    if (before.secret === undefined) delete process.env.IYZIPAY_SECRET_KEY;
    else process.env.IYZIPAY_SECRET_KEY = before.secret;
});
