const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { logger } = require('../lib/logger');
const { shortCode, token: randomToken } = require('../lib/ids');
const { sendVerification, autoVerifyEnabled, transport } = require('../lib/mailer');
const {
  validateUsername, validateEmail, validatePassword, normalizeUsername,
} = require('../lib/accounts');

/** The canonical origin for generated links: PUBLIC_URL wins in production. */
const publicBase = req => (process.env.PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

const router = express.Router();
const isProd = () => process.env.NODE_ENV === 'production';

const publicUser = u => ({
  id: u.id, name: u.name, username: u.username, email: u.email,
  role: u.role, emailVerified: !!u.email_verified,
});

/** Allocates a referral code that isn't taken yet. */
async function uniqueReferralCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shortCode(8);
    const [rows] = await pool.execute('SELECT 1 FROM users WHERE referral_code = ?', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Could not allocate a referral code');
}

// POST /api/auth/register { name, username, email, password, role?, referralCode? }
router.post('/register', async (req, res, next) => {
  try {
    const { name, password, role, referralCode } = req.body || {};

    const username = validateUsername(req.body?.username);
    if (!username.ok) return res.status(400).json({ error: username.error });
    const email = validateEmail(req.body?.email);
    if (!email.ok) return res.status(400).json({ error: email.error });
    const pass = validatePassword(password);
    if (!pass.ok) return res.status(400).json({ error: pass.error });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Full name is required' });
    const accountRole = role === 'parent' ? 'parent' : 'student';

    // referral is optional, but a wrong code should not fail silently
    let referrerId = null;
    if (referralCode) {
      const [rows] = await pool.execute(
        'SELECT id FROM users WHERE referral_code = ?', [String(referralCode).trim().toUpperCase()]
      );
      if (rows.length === 0) return res.status(400).json({ error: 'That referral code does not exist' });
      referrerId = rows[0].id;
    }

    // AUTO_VERIFY exists for demo deployments with no mail provider: accounts
    // are usable immediately instead of waiting on a link nobody receives.
    const autoVerify = autoVerifyEnabled();
    const verificationToken = autoVerify ? null : randomToken(24);

    const [result] = await pool.execute(
      `INSERT INTO users (name, username, email, password_hash, role, referral_code,
                          referred_by, verification_token, email_verified, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(name).trim(), username.value, email.value, await bcrypt.hash(pass.value, 10),
       accountRole, await uniqueReferralCode(), referrerId, verificationToken,
       autoVerify ? 1 : 0, autoVerify ? new Date() : null]
    );

    const user = { id: result.insertId, name, username: username.value, email: email.value, role: accountRole };

    if (autoVerify) {
      return res.status(201).json({ message: 'Account created. You can sign in now.', user, verified: true });
    }

    const verifyUrl = `${publicBase(req)}/api/auth/verify?token=${verificationToken}`;
    const delivery = await sendVerification({ to: email.value, name, url: verifyUrl });
    logger.info('verification link issued', { user: user.id, delivered: delivery.delivered });

    res.status(201).json({
      message: delivery.delivered
        ? 'Account created. Check your email for the verification link.'
        : 'Account created. Verify your email address to sign in.',
      user,
      emailSent: delivery.delivered,
      // Without a mail provider the link would be unreachable, so it is returned
      // to the client. Never do this once email actually works.
      ...(delivery.delivered || isProd() && transport() === 'resend' ? {} : { verifyUrl }),
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const field = /username/.test(err.message) ? 'username' : 'email address';
      return res.status(409).json({ error: `That ${field} is already registered` });
    }
    next(err);
  }
});

// GET /api/auth/verify?token=... — clicked from the emailed (here: logged) link
router.get('/verify', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    if (!token) return res.redirect('/?verified=invalid');
    const [result] = await pool.execute(
      `UPDATE users SET email_verified = 1, verified_at = NOW(), verification_token = NULL
       WHERE verification_token = ?`,
      [token]
    );
    return res.redirect(result.affectedRows ? '/?verified=1' : '/?verified=invalid');
  } catch (err) { next(err); }
});

// POST /api/auth/resend { email } — always answers the same way, so the
// endpoint cannot be used to discover which addresses are registered.
router.post('/resend', async (req, res, next) => {
  try {
    const email = validateEmail(req.body?.email);
    const generic = { message: 'If that account exists and is unverified, a new link has been issued.' };
    if (!email.ok) return res.json(generic);

    const [rows] = await pool.execute(
      'SELECT id, name, email_verified FROM users WHERE email = ?', [email.value]
    );
    if (rows.length === 0 || rows[0].email_verified) return res.json(generic);

    const verificationToken = randomToken(24);
    await pool.execute('UPDATE users SET verification_token = ? WHERE id = ?', [verificationToken, rows[0].id]);
    const verifyUrl = `${publicBase(req)}/api/auth/verify?token=${verificationToken}`;
    const delivery = await sendVerification({ to: email.value, name: rows[0].name, url: verifyUrl });
    logger.info('verification link re-issued', { user: rows[0].id, delivered: delivery.delivered });
    res.json(delivery.delivered ? generic : { ...generic, verifyUrl });
  } catch (err) { next(err); }
});

// POST /api/auth/login { identifier, password } — identifier is a username or email
router.post('/login', async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username or email and password are required' });
    }

    const [rows] = await pool.execute(
      `SELECT id, name, username, email, password_hash, role, email_verified
       FROM users WHERE email = ? OR username = ? LIMIT 1`,
      [identifier.toLowerCase(), normalizeUsername(identifier)]
    );
    const user = rows[0];

    // Same message either way: never reveal whether an account exists.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Verify your email address before signing in', needsVerification: true });
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) { next(err); }
});

// GET /api/auth/available?username=  — live check for the signup form
router.get('/available', async (req, res, next) => {
  try {
    const username = validateUsername(req.query.username);
    if (!username.ok) return res.json({ available: false, reason: username.error });
    const [rows] = await pool.execute('SELECT 1 FROM users WHERE username = ?', [username.value]);
    res.json({ available: rows.length === 0, reason: rows.length ? 'Already taken' : 'Available' });
  } catch (err) { next(err); }
});

module.exports = router;
