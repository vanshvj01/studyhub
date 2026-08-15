const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { setAuthCookie, clearAuthCookie } = require('../lib/cookies');
const { logger } = require('../lib/logger');
const { shortCode, token: randomToken } = require('../lib/ids');
const { sendVerification, sendPasswordReset, autoVerifyEnabled, transport } = require('../lib/mailer');
const { normalizePhone, looksLikePhone } = require('../lib/phone');
const google = require('../lib/google');
const {
  validateUsername, validateEmail, validatePassword, normalizeUsername,
} = require('../lib/accounts');

/** The canonical origin for generated links: PUBLIC_URL wins in production. */
const publicBase = req => (process.env.PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

const jwt = require('jsonwebtoken');
const { usernameFromEmail } = require('../lib/accounts');
const usernameFromEmailSafe = email => {
  const candidate = usernameFromEmail(email);
  return validateUsername(candidate).ok ? candidate : `user${Date.now().toString().slice(-6)}`;
};

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

    let phone = null;
    if (req.body?.phone) {
      phone = normalizePhone(req.body.phone);
      if (!phone) return res.status(400).json({ error: 'Enter a valid phone number, or leave it blank' });
    }

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
      `INSERT INTO users (name, username, email, phone, password_hash, role, referral_code,
                          referred_by, verification_token, email_verified, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(name).trim(), username.value, email.value, phone, await bcrypt.hash(pass.value, 10),
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
      const field = /username/.test(err.message) ? 'username'
                  : /phone/.test(err.message) ? 'phone number' : 'email address';
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

    // One field accepts a username, an email address or a phone number.
    const asPhone = looksLikePhone(identifier) ? normalizePhone(identifier) : null;
    const [rows] = await pool.execute(
      `SELECT id, name, username, email, password_hash, role, email_verified
       FROM users WHERE email = ? OR username = ? OR (phone IS NOT NULL AND phone = ?) LIMIT 1`,
      [identifier.toLowerCase(), normalizeUsername(identifier), asPhone]
    );
    const user = rows[0];

    // Same message either way: never reveal whether an account exists.
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: user && !user.password_hash
          ? 'This account signs in with Google'
          : 'Invalid credentials',
      });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Verify your email address before signing in', needsVerification: true });
    }

    const token = signToken(user);
    setAuthCookie(res, token);   // survives a refresh; JS never sees it
    res.json({ token, user: publicUser(user) });
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

// POST /api/auth/forgot { identifier } — username, email or phone
router.post('/forgot', async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier || '').trim();
    // Always the same answer, so this cannot be used to discover accounts.
    const generic = { message: 'If that account exists, a reset link is on its way.' };
    if (!identifier) return res.json(generic);

    const asPhone = looksLikePhone(identifier) ? normalizePhone(identifier) : null;
    const [rows] = await pool.execute(
      `SELECT id, name, email FROM users
       WHERE email = ? OR username = ? OR (phone IS NOT NULL AND phone = ?) LIMIT 1`,
      [identifier.toLowerCase(), normalizeUsername(identifier), asPhone]
    );
    if (rows.length === 0) return res.json(generic);

    const resetToken = randomToken(24);
    await pool.execute(
      'UPDATE users SET reset_token = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 60 MINUTE) WHERE id = ?',
      [resetToken, rows[0].id]
    );
    const resetUrl = `${publicBase(req)}/?reset=${resetToken}`;
    const delivery = await sendPasswordReset({ to: rows[0].email, name: rows[0].name, url: resetUrl });
    logger.info('password reset requested', { user: rows[0].id, delivered: delivery.delivered });

    // With no mail provider the link would be unreachable, so it comes back in
    // the response instead. Once email works this branch never runs.
    res.json(delivery.delivered ? generic : { ...generic, resetUrl });
  } catch (err) { next(err); }
});

// POST /api/auth/reset { token, password }
router.post('/reset', async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Reset token is missing' });
    const checked = validatePassword(password);
    if (!checked.ok) return res.status(400).json({ error: checked.error });

    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE reset_token = ? AND reset_expires > NOW() LIMIT 1',
      [String(token)]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'That reset link is invalid or has expired. Request a new one.' });
    }

    await pool.execute(
      `UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL,
              email_verified = 1, verified_at = COALESCE(verified_at, NOW())
       WHERE id = ?`,
      [await bcrypt.hash(checked.value, 10), rows[0].id]
    );
    logger.info('password reset completed', { user: rows[0].id });
    res.json({ message: 'Password updated. You can sign in now.' });
  } catch (err) { next(err); }
});

// POST /api/auth/logout — clears the session cookie
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Signed out' });
});

// GET /api/auth/providers — lets the client show only what is actually configured
router.get('/providers', (req, res) => {
  res.json({ google: google.isConfigured(), autoVerify: autoVerifyEnabled(), email: transport() === 'resend' });
});

// GET /api/auth/google?mode=signin|classroom — start the OAuth dance
router.get('/google', (req, res) => {
  if (!google.isConfigured()) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this deployment' });
  }
  const mode = req.query.mode === 'classroom' ? 'classroom' : 'signin';
  // The state is signed, so the callback can trust which user asked and why.
  const state = jwt.sign({ mode, link: req.query.link || null }, process.env.JWT_SECRET, { expiresIn: '10m' });
  res.redirect(google.authUrl({ base: `${req.protocol}://${req.get('host')}`, state, mode }));
});

// GET /api/auth/google/callback — Google sends the user back here
router.get('/google/callback', async (req, res, next) => {
  try {
    if (req.query.error) return res.redirect('/?google=denied');
    const { code, state } = req.query;
    if (!code || !state) return res.redirect('/?google=failed');

    let payload;
    try {
      payload = jwt.verify(String(state), process.env.JWT_SECRET);
    } catch {
      return res.redirect('/?google=expired');
    }

    const base = `${req.protocol}://${req.get('host')}`;
    const tokens = await google.exchangeCode({ code: String(code), base });
    const profile = await google.fetchProfile(tokens.access_token);
    if (!profile.email) return res.redirect('/?google=noemail');

    const email = profile.email.toLowerCase();
    const [existing] = await pool.execute(
      'SELECT id, name, username, email, role FROM users WHERE google_id = ? OR email = ? LIMIT 1',
      [profile.sub, email]
    );

    let user = existing[0];
    if (user) {
      await pool.execute(
        `UPDATE users SET google_id = ?, email_verified = 1,
                verified_at = COALESCE(verified_at, NOW()),
                avatar = COALESCE(avatar, ?),
                google_refresh_token = COALESCE(?, google_refresh_token),
                google_scopes = COALESCE(?, google_scopes)
         WHERE id = ?`,
        [profile.sub, profile.picture || null, tokens.refresh_token || null, tokens.scope || null, user.id]
      );
    } else {
      // First sign-in: build a free username from the email local part.
      const base = usernameFromEmailSafe(email);
      let username = base;
      for (let n = 1; ; n++) {
        const [taken] = await pool.execute('SELECT 1 FROM users WHERE username = ?', [username]);
        if (taken.length === 0) break;
        username = `${base.slice(0, 17)}${n}`;
      }
      const [result] = await pool.execute(
        `INSERT INTO users (name, username, email, google_id, avatar, role, referral_code,
                            email_verified, verified_at, google_refresh_token, google_scopes)
         VALUES (?, ?, ?, ?, ?, 'student', ?, 1, NOW(), ?, ?)`,
        [profile.name || username, username, email, profile.sub, profile.picture || null,
         await uniqueReferralCode(), tokens.refresh_token || null, tokens.scope || null]
      );
      user = { id: result.insertId, name: profile.name || username, username, email, role: 'student' };
      logger.info('account created via Google', { user: user.id });
    }

    const token = signToken(user);
    setAuthCookie(res, token);
    // The cookie carries the session; no token in the URL at all now.
    res.redirect(payload.mode === 'classroom' ? '/?google=classroom' : '/?google=1');
  } catch (err) {
    logger.error('google sign-in failed', { error: err.message, code: err.code || null });
    // The reason travels back to the UI so the cause is visible without log access.
    res.redirect(`/?google=failed&reason=${encodeURIComponent(err.code || 'unknown')}`);
  }
});

module.exports = router;
