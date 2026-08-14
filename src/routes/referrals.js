// Referral codes. Every account gets one at signup; new users may enter one,
// which records who invited them.
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

/** The canonical origin for generated links: PUBLIC_URL wins in production. */
const publicBase = req => (process.env.PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

const router = express.Router();
router.use(requireAuth);

// GET /api/referrals — my code, my link, and who has joined with it
router.get('/', async (req, res, next) => {
  try {
    const [[me]] = await pool.execute('SELECT referral_code FROM users WHERE id = ?', [req.user.id]);
    const [joined] = await pool.execute(
      `SELECT id, name, username, avatar, role, created_at, email_verified
       FROM users WHERE referred_by = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    const [[invitedBy]] = await pool.execute(
      `SELECT r.name, r.username FROM users u
       LEFT JOIN users r ON r.id = u.referred_by WHERE u.id = ?`,
      [req.user.id]
    );

    res.json({
      code: me?.referral_code || null,
      link: `${publicBase(req)}/?ref=${me?.referral_code || ''}`,
      invitedBy: invitedBy?.username ? { name: invitedBy.name, username: invitedBy.username } : null,
      joined: joined.map(j => ({
        id: j.id, name: j.name, username: j.username, avatar: j.avatar, role: j.role,
        joinedAt: j.created_at, verified: !!j.email_verified,
      })),
      total: joined.length,
      verifiedTotal: joined.filter(j => j.email_verified).length,
    });
  } catch (err) { next(err); }
});

module.exports = router;
