// Pure rules for account creation. Kept out of the routes so they are testable
// and so the frontend and backend can agree on the same messages.

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Usernames are case-insensitive: stored and compared in lower case. */
function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function validateUsername(raw) {
  const username = normalizeUsername(raw);
  if (!username) return { ok: false, error: 'Username is required' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Username must be 3-20 characters: lowercase letters, numbers or underscore' };
  }
  return { ok: true, value: username };
}

function validateEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address' };
  return { ok: true, value: email };
}

/**
 * Password rules, deliberately modest but real: length does more for security
 * than symbol soup, so the bar is 8+ characters with at least one letter and
 * one number, and no obviously guessable value.
 */
const COMMON = ['password', 'password1', '12345678', 'qwerty123', 'studyhub', 'letmein1'];

function validatePassword(raw) {
  const password = String(raw || '');
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
  if (password.length > 200) return { ok: false, error: 'Password is too long' };
  if (!/[a-zA-Z]/.test(password)) return { ok: false, error: 'Password must contain at least one letter' };
  if (!/[0-9]/.test(password)) return { ok: false, error: 'Password must contain at least one number' };
  if (COMMON.includes(password.toLowerCase())) return { ok: false, error: 'That password is too common' };
  return { ok: true, value: password };
}

/** 0-4, for the strength meter on the signup form. */
function passwordStrength(password = '') {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

/** Derives a legal username from an email address, for backfilling old rows. */
function usernameFromEmail(email) {
  const base = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  return (base || 'user').slice(0, 16).padEnd(3, '0');
}

module.exports = {
  normalizeUsername, validateUsername, validateEmail,
  validatePassword, passwordStrength, usernameFromEmail,
};
