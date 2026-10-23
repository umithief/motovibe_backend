import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  revenueCatUpdateForEvent,
  verifyRevenueCatSignature,
} from "../modules/subscriptions/controller.js";

function signatureFor(rawBody, timestamp, secret) {
  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    rawBody,
  ]);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

test('accepts a current RevenueCat HMAC-SHA256 signature', () => {
  const nowMs = Date.UTC(2026, 7, 9, 12, 0, 0);
  const timestamp = Math.floor(nowMs / 1000);
  const rawBody = Buffer.from('{"event":{"type":"RENEWAL"}}');
  const secret = 'test-signing-secret';

  assert.equal(verifyRevenueCatSignature({
    rawBody,
    signatureHeader: signatureFor(rawBody, timestamp, secret),
    secret,
    nowMs,
  }), true);
});

test('rejects invalid and replayed RevenueCat signatures', () => {
  const nowMs = Date.UTC(2026, 7, 9, 12, 0, 0);
  const currentTimestamp = Math.floor(nowMs / 1000);
  const oldTimestamp = currentTimestamp - 301;
  const rawBody = Buffer.from('{"event":{"type":"RENEWAL"}}');
  const secret = 'test-signing-secret';

  assert.equal(verifyRevenueCatSignature({
    rawBody,
    signatureHeader: signatureFor(rawBody, currentTimestamp, 'wrong-secret'),
    secret,
    nowMs,
  }), false);
  assert.equal(verifyRevenueCatSignature({
    rawBody,
    signatureHeader: signatureFor(rawBody, oldTimestamp, secret),
    secret,
    nowMs,
  }), false);
});

test('cancellation retains access until expiration and expiration revokes it', () => {
  const expirationAt = Date.UTC(2026, 8, 1);
  const cancellation = revenueCatUpdateForEvent({
    type: 'CANCELLATION',
    app_user_id: 'user-id',
    expiration_at_ms: expirationAt,
  });
  const expiration = revenueCatUpdateForEvent({
    type: 'EXPIRATION',
    app_user_id: 'user-id',
    expiration_at_ms: expirationAt,
  });

  assert.equal(cancellation.isPro, true);
  assert.equal(cancellation.isPremium, true);
  assert.equal(cancellation.proExpiryDate.getTime(), expirationAt);
  assert.equal(expiration.isPro, false);
  assert.equal(expiration.isPremium, false);
});
