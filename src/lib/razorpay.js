// Razorpay over plain fetch — no SDK. Test mode needs nothing but a key pair,
// so the whole flow (checkout, callback, webhook) works without a registered
// business, which is exactly what a portfolio deployment needs.
const crypto = require('crypto');
const { logger } = require('./logger');

const API = 'https://api.razorpay.com/v1';

const isConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const isTestMode = () => String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test');
const publicKey = () => process.env.RAZORPAY_KEY_ID || null;

const authHeader = () =>
  'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

/** Creates an order. `receipt` is our own reference, echoed back on the webhook. */
async function createOrder({ amountPaise, receipt, notes = {} }) {
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes, payment_capture: 1 }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error('razorpay order creation failed', { status: res.status, detail: detail.slice(0, 200) });
    throw Object.assign(new Error('Could not start the payment. Try again in a moment.'), { status: 502 });
  }
  return res.json();   // { id: 'order_...', amount, currency, status }
}

/**
 * Verifies the signature the browser hands back after checkout.
 * Razorpay signs "<order_id>|<payment_id>" with the key secret.
 */
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return timingSafeEqual(expected, signature);
}

/** Verifies a webhook: the raw body is signed with the webhook secret. */
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(expected, signature);
}

/** Constant-time compare — a fast-exit compare leaks the signature byte by byte. */
function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function fetchPayment(paymentId) {
  const res = await fetch(`${API}/payments/${paymentId}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw Object.assign(new Error('Could not confirm that payment'), { status: 502 });
  return res.json();
}

module.exports = {
  isConfigured, isTestMode, publicKey, createOrder,
  verifyCheckoutSignature, verifyWebhookSignature, fetchPayment,
};
