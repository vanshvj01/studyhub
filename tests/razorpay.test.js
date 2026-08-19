const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_value';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret_value';
const razorpay = require('../src/lib/razorpay');

const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

test('configuration is detected, and test mode is recognised', () => {
  assert.equal(razorpay.isConfigured(), true);
  assert.equal(razorpay.isTestMode(), true, 'rzp_test_ keys are test mode');
  assert.equal(razorpay.publicKey(), 'rzp_test_abc123');
});

test('a genuine checkout signature verifies', () => {
  const orderId = 'order_ABC', paymentId = 'pay_XYZ';
  const signature = sign(`${orderId}|${paymentId}`, 'test_secret_value');
  assert.equal(razorpay.verifyCheckoutSignature({ orderId, paymentId, signature }), true);
});

test('a tampered amount, order or payment id fails verification', () => {
  const signature = sign('order_ABC|pay_XYZ', 'test_secret_value');
  assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'order_OTHER', paymentId: 'pay_XYZ', signature }), false);
  assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_OTHER', signature }), false);
});

test('a signature made with the wrong secret fails', () => {
  const signature = sign('order_ABC|pay_XYZ', 'attacker_secret');
  assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature }), false);
});

test('missing pieces fail closed rather than passing', () => {
  assert.equal(razorpay.verifyCheckoutSignature({}), false);
  assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'o', paymentId: 'p', signature: '' }), false);
  assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'o', paymentId: 'p', signature: 'short' }), false);
});

test('a webhook signed over the raw body verifies', () => {
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
  assert.equal(razorpay.verifyWebhookSignature(body, sign(body, 'webhook_secret_value')), true);
});

test('a webhook body altered in transit does not', () => {
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', amount: 100 }));
  const signature = sign(body, 'webhook_secret_value');
  const tampered = Buffer.from(JSON.stringify({ event: 'payment.captured', amount: 999999 }));
  assert.equal(razorpay.verifyWebhookSignature(tampered, signature), false);
});

test('an unsigned webhook is rejected', () => {
  const body = Buffer.from('{}');
  assert.equal(razorpay.verifyWebhookSignature(body, undefined), false);
  assert.equal(razorpay.verifyWebhookSignature(body, ''), false);
  assert.equal(razorpay.verifyWebhookSignature(null, 'anything'), false);
});
