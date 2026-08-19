// Answers "what is this user allowed to do right now?" once per request.
const { pool } = require('../config/db');
const { resolveAccess, FREE_LIMITS } = require('../lib/plans');

/** Loads live entitlements onto req.access. Cheap: one indexed query. */
async function loadAccess(req, res, next) {
  try {
    if (!req.user) { req.access = { pro: false, limits: FREE_LIMITS, sources: [] }; return next(); }
    const [rows] = await pool.execute(
      `SELECT source, plan_code, access_until, granted_by, revoked_at
       FROM entitlements WHERE user_id = ? AND revoked_at IS NULL AND access_until > NOW()`,
      [req.user.id]
    );
    req.access = resolveAccess(rows);
    next();
  } catch (err) { next(err); }
}

/**
 * Gate for a paid capability. Returns 402 Payment Required — the honest status
 * code, and one the client can branch on to show the upgrade card.
 */
function requirePro(feature = 'this feature') {
  return (req, res, next) => {
    if (req.access?.pro) return next();
    res.status(402).json({
      error: `${feature} needs an exam pass`,
      upgrade: true,
      feature,
    });
  };
}

module.exports = { loadAccess, requirePro };
