// Minimal cookie handling — no dependency needed for one cookie.
//
// The session token is stored in an httpOnly cookie rather than localStorage:
// JavaScript cannot read it, so an XSS bug cannot walk off with a login. The
// Authorization header still works, which keeps Postman and any API client happy.
const COOKIE_NAME = 'studyhub_session';

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    if (!key || key in out) continue;      // first occurrence wins
    const value = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

/** Reads the session token from the Authorization header, falling back to the cookie. */
function tokenFromRequest(req) {
  const header = req.headers?.authorization || '';
  if (header.startsWith('Bearer ')) {
    const value = header.slice(7).trim();
    if (value) return value;
  }
  return parseCookies(req.headers?.cookie)[COOKIE_NAME] || null;
}

function cookieOptions() {
  const days = 7;
  return {
    httpOnly: true,
    sameSite: 'lax',                                  // blocks cross-site POSTs, keeps normal navigation working
    secure: process.env.NODE_ENV === 'production',    // https only once deployed
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

const setAuthCookie = (res, token) => res.cookie(COOKIE_NAME, token, cookieOptions());
const clearAuthCookie = res => res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });

module.exports = { COOKIE_NAME, parseCookies, tokenFromRequest, setAuthCookie, clearAuthCookie, cookieOptions };
