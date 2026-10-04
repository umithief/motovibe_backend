/**
 * MotoVibe PRO - RevenueCat webhook controller.
 *
 * The global JSON parser in server.js preserves the original request bytes in
 * req.rawBody. RevenueCat signs `<timestamp>.<raw_body>` with HMAC-SHA256.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';

const DEFAULT_REPLAY_TOLERANCE_SECONDS = 300;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function parseRevenueCatSignature(header) {
  const parts = String(header ?? '').split(',');
  const parsed = {};
  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    parsed[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return { timestamp: parsed.t, signature: parsed.v1 };
}

export function verifyRevenueCatSignature({
  rawBody,
  signatureHeader,
  secret,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_REPLAY_TOLERANCE_SECONDS,
}) {
  if (!Buffer.isBuffer(rawBody) || !secret) return false;

  const { timestamp, signature } = parseRevenueCatSignature(signatureHeader);
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || !signature) return false;

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds > toleranceSeconds) return false;

  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    rawBody,
  ]);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return safeEqual(expected, signature);
}

function toExpiryDate(unixMs) {
  const numericValue = Number(unixMs);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  const value = new Date(numericValue);
  return Number.isNaN(value.getTime()) ? null : value;
}

function activeSubscriptionUpdate(event) {
  return {
    isPro: true,
    isPremium: true,
    proExpiryDate: toExpiryDate(event.expiration_at_ms)
      ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revenueCatId: event.app_user_id,
  };
}

export function revenueCatUpdateForEvent(event) {
  switch (event?.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'NON_RENEWING_PURCHASE':
      return activeSubscriptionUpdate(event);
    case 'CANCELLATION':
      // Cancellation disables renewal, but access remains active until expiry.
      return {
        isPro: true,
        isPremium: true,
        proExpiryDate: toExpiryDate(event.expiration_at_ms),
        revenueCatId: event.app_user_id,
      };
    case 'EXPIRATION':
      return {
        isPro: false,
        isPremium: false,
        proExpiryDate: toExpiryDate(event.expiration_at_ms),
      };
    default:
      return null;
  }
}

function webhookConfiguration() {
  return {
    signingSecret: process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET
      || process.env.REVENUECAT_WEBHOOK_SECRET,
    authorizationHeader: process.env.REVENUECAT_WEBHOOK_AUTH_HEADER,
  };
}

function verifyWebhookRequest(req, config) {
  if (config.authorizationHeader
      && !safeEqual(req.headers.authorization, config.authorizationHeader)) {
    return { ok: false, status: 401, message: 'Invalid authorization' };
  }

  if (config.signingSecret && !verifyRevenueCatSignature({
    rawBody: req.rawBody,
    signatureHeader: req.headers['x-revenuecat-webhook-signature'],
    secret: config.signingSecret,
  })) {
    return { ok: false, status: 401, message: 'Invalid signature' };
  }

  if (!config.signingSecret && !config.authorizationHeader) {
    return { ok: false, status: 503, message: 'Webhook verification is not configured' };
  }

  return { ok: true };
}

export const handleRevenueCatWebhook = async (req, res) => {
  try {
    const verification = verifyWebhookRequest(req, webhookConfiguration());
    if (!verification.ok) {
      console.warn(`[RevenueCat Webhook] Rejected: ${verification.message}`);
      return res.status(verification.status).json({
        status: 'error',
        message: verification.message,
      });
    }

    const event = req.body?.event;
    if (!event?.type || !event?.app_user_id) {
      return res.status(400).json({ status: 'error', message: 'Missing event payload' });
    }

    console.log(`[RevenueCat Webhook] Event: ${event.type} | User: ${event.app_user_id}`);

    if (event.type === 'BILLING_ISSUE') {
      // Access remains active during RevenueCat's grace period.
      return res.status(200).json({ status: 'ok', message: 'Billing issue noted' });
    }

    if (event.type === 'SUBSCRIBER_ALIAS') {
      return res.status(200).json({ status: 'ok', message: 'Alias event ignored' });
    }

    const updatePayload = revenueCatUpdateForEvent(event);
    if (!updatePayload) {
      return res.status(200).json({ status: 'ok', message: 'Event type not handled' });
    }

    const User = mongoose.model('User');
    let user = await User.findOne({ revenueCatId: event.app_user_id });
    if (!user && mongoose.isValidObjectId(event.app_user_id)) {
      user = await User.findById(event.app_user_id);
    }

    if (!user) {
      console.warn(`[RevenueCat Webhook] User not found: ${event.app_user_id}`);
      return res.status(200).json({ status: 'ok', message: 'User not found; event ignored' });
    }

    await User.findByIdAndUpdate(user._id, { $set: updatePayload });
    console.log(
      `[RevenueCat Webhook] Updated user ${user._id} (${event.type}) -> isPro=${updatePayload.isPro}`,
    );
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[RevenueCat Webhook] Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
