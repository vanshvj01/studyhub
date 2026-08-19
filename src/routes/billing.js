// Checkout, verification, webhooks and history.
//
// Two paths grant access: the browser callback (fast, so the UI updates
// immediately) and the webhook (authoritative, arrives even if the user closes
// the tab). Both funnel through the same idempotent grant, so a payment can be
// confirmed twice without ever handing out two passes.
const express = require('express');
const { pool } = require('../config/db');
const razorpay = require('../lib/razorpay');
const { getPlan, listPlans, nextAccessUntil, formatPrice } = require('../lib/plans');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadAccess } = require('../middleware/entitlements');
const { validate } = require('../lib/validate');
const { logger } = require('../lib/logger');

const router = express.Router();

// ---------------------------------------------------------------- public bits

// GET /api/billing/plans — the catalogue, and whether payments are switched on
router.get('/plans', (req, res) => {
  res.json({
    configured: razorpay.isConfigured(),
    testMode: razorpay.isTestMode(),
    keyId: razorpay.publicKey(),
    plans: listPlans(),
  });
});

// ------------------------------------------------------------------- webhooks
// Mounted before the JSON body parser in server.js: the signature covers the
// raw bytes, so a re-serialised body would never verify.
router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!razorpay.verifyWebhookSignature(req.body, signature)) {
    logger.warn('rejected a webhook with a bad signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Malformed payload' });
  }

  // Always 200 once the signature is good: a non-2xx makes Razorpay retry, and
  // a bug in our handling should not turn into an infinite retry loop.
  res.json({ received: true });

  try {
    const payment = event?.payload?.payment?.entity;
    if (!payment) return;

    if (event.event === 'payment.captured') {
      await grantForOrder({ orderId: payment.order_id, paymentRef: payment.id, via: 'webhook' });
    } else if (event.event === 'payment.failed') {
      await pool.execute(
        "UPDATE payments SET status = 'failed', payment_ref = ? WHERE order_id = ? AND status = 'created'",
        [payment.id, payment.order_id]
      );
      logger.info('payment failed', { order: payment.order_id });
    }
  } catch (err) {
    logger.error('webhook handling failed', { event: event?.event, error: err.message });
  }
});

// ------------------------------------------------------------- authenticated
// This router is mounted before the app-wide JSON parser (so the webhook above
// can see raw bytes), which means everything below needs its own.
router.use(express.json({ limit: '100kb' }));
router.use(requireAuth, loadAccess);

// GET /api/billing/me — what the current user has
router.get('/me', async (req, res, next) => {
  try {
    const [history] = await pool.execute(
      `SELECT plan_code, amount_paise, currency, status, created_at, paid_at
       FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({
      ...req.access,
      history: history.map(h => ({ ...h, price: formatPrice(h.amount_paise), plan: getPlan(h.plan_code)?.name || h.plan_code })),
    });
  } catch (err) { next(err); }
});

// POST /api/billing/order { planCode } — start a checkout
router.post('/order', requireRole('student'), validate({
  planCode: { type: 'string', required: true, maxLen: 40 },
}), async (req, res, next) => {
  try {
    if (!razorpay.isConfigured()) {
      return res.status(503).json({ error: 'Payments are not configured on this deployment' });
    }
    const plan = getPlan(req.body.planCode);
    if (!plan) return res.status(404).json({ error: 'No such plan' });

    const order = await razorpay.createOrder({
      amountPaise: plan.amountPaise,
      receipt: `u${req.user.id}-${Date.now()}`,
      notes: { userId: String(req.user.id), planCode: plan.code },
    });

    await pool.execute(
      `INSERT INTO payments (user_id, provider, order_id, plan_code, amount_paise, currency, status)
       VALUES (?, 'razorpay', ?, ?, ?, 'INR', 'created')`,
      [req.user.id, order.id, plan.code, plan.amountPaise]
    );
    logger.info('checkout started', { user: req.user.id, plan: plan.code, order: order.id });

    res.status(201).json({
      orderId: order.id,
      amountPaise: plan.amountPaise,
      currency: 'INR',
      keyId: razorpay.publicKey(),
      plan: { code: plan.code, name: plan.name, days: plan.days, price: formatPrice(plan.amountPaise) },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/billing/verify — the browser's callback after a successful checkout
router.post('/verify', validate({
  orderId: { type: 'string', required: true, maxLen: 64 },
  paymentId: { type: 'string', required: true, maxLen: 64 },
  signature: { type: 'string', required: true, maxLen: 128 },
}), async (req, res, next) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    if (!razorpay.verifyCheckoutSignature({ orderId, paymentId, signature })) {
      logger.warn('checkout signature rejected', { user: req.user.id, order: orderId });
      return res.status(400).json({ error: 'That payment could not be verified' });
    }
    const granted = await grantForOrder({ orderId, paymentRef: paymentId, via: 'checkout', userId: req.user.id });
    if (!granted) return res.status(404).json({ error: 'No such order' });
    res.json({ message: 'Payment confirmed', ...granted });
  } catch (err) { next(err); }
});

/**
 * Turns a paid order into access. Idempotent by design: the first call flips the
 * payment row from 'created' to 'paid' and only that transition writes the
 * entitlement, so the webhook and the browser callback racing each other is fine.
 */
async function grantForOrder({ orderId, paymentRef, via, userId = null }) {
  const [[payment]] = await pool.execute(
    'SELECT id, user_id, plan_code, status FROM payments WHERE order_id = ?', [orderId]
  );
  if (!payment) return null;
  if (userId && payment.user_id !== userId) return null;   // not this user's order

  const plan = getPlan(payment.plan_code);
  if (!plan) return null;

  const [claim] = await pool.execute(
    "UPDATE payments SET status = 'paid', payment_ref = ?, paid_at = NOW() WHERE id = ? AND status = 'created'",
    [paymentRef, payment.id]
  );

  if (claim.affectedRows === 0) {
    // Already granted by the other path — report the current state, change nothing.
    const [[existing]] = await pool.execute(
      `SELECT MAX(access_until) AS until FROM entitlements
       WHERE user_id = ? AND revoked_at IS NULL AND access_until > NOW()`,
      [payment.user_id]
    );
    logger.debug('duplicate grant ignored', { order: orderId, via });
    return { alreadyProcessed: true, until: existing?.until || null, plan: plan.name };
  }

  const [[current]] = await pool.execute(
    `SELECT MAX(access_until) AS until FROM entitlements
     WHERE user_id = ? AND revoked_at IS NULL AND access_until > NOW()`,
    [payment.user_id]
  );
  const until = nextAccessUntil(current?.until, plan.days);

  await pool.execute(
    `INSERT INTO entitlements (user_id, source, plan_code, access_until, payment_id)
     VALUES (?, ?, ?, ?, ?)`,
    [payment.user_id, plan.source, plan.code, until, payment.id]
  );

  logger.info('access granted', { user: payment.user_id, plan: plan.code, until, via });
  return { plan: plan.name, days: plan.days, until, extended: Boolean(current?.until) };
}

module.exports = router;
module.exports.grantForOrder = grantForOrder;
