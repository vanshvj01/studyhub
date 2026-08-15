// Google OAuth 2.0 and Classroom, over plain fetch — no SDK, no dependency.
// Everything here is dormant until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
// are set, so the app runs unchanged without a Google project.
const { logger } = require('./logger');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const CLASSROOM = 'https://classroom.googleapis.com/v1';

// Sign-in needs identity only. Classroom import asks for read-only coursework —
// StudyHub never writes back to a student's Classroom.
const SCOPES = {
  signin: ['openid', 'email', 'profile'],
  classroom: [
    'openid', 'email', 'profile',
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.announcements.readonly',
    'https://www.googleapis.com/auth/classroom.course-work.readonly',
  ],
};

const isConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const redirectUri = base => `${(process.env.PUBLIC_URL || base).replace(/\/$/, '')}/api/auth/google/callback`;

/** The consent screen URL. `state` carries our own signed payload back to us. */
function authUrl({ base, state, mode = 'signin' }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(base),
    response_type: 'code',
    scope: (SCOPES[mode] || SCOPES.signin).join(' '),
    access_type: 'offline',        // needed for a refresh token
    include_granted_scopes: 'true',
    prompt: mode === 'classroom' ? 'consent' : 'select_account',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function exchangeCode({ code, base }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(base),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    // Google's body names the actual problem: invalid_client (wrong secret),
    // redirect_uri_mismatch, invalid_grant (reused or expired code)...
    const raw = await res.text().catch(() => '');
    let code = 'token_exchange_failed';
    try { code = JSON.parse(raw).error || code; } catch { /* not JSON */ }
    logger.error('google token exchange failed', { status: res.status, code, detail: raw.slice(0, 200) });
    throw Object.assign(new Error(`Google rejected the sign-in (${code})`), { status: 400, code });
  }
  return res.json(); // { access_token, refresh_token?, expires_in, id_token }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw Object.assign(new Error('Google session expired — reconnect Classroom'), { status: 401 });
  return res.json();
}

async function fetchProfile(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw Object.assign(new Error('Could not read your Google profile'), { status: 400 });
  return res.json(); // { sub, email, email_verified, name, picture }
}

/** GET helper for the Classroom API, with paging folded in. */
async function classroomGet(accessToken, path, key, params = {}) {
  const items = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ ...params, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const res = await fetch(`${CLASSROOM}${path}?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 403) {
      throw Object.assign(new Error('Google Classroom access was not granted — reconnect and allow the requested permissions'), { status: 403 });
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error('classroom request failed', { path, status: res.status, detail: detail.slice(0, 200) });
      throw Object.assign(new Error('Google Classroom request failed'), { status: 502 });
    }
    const body = await res.json();
    items.push(...(body[key] || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return items;
}

const listCourses = token => classroomGet(token, '/courses', 'courses', { courseStates: 'ACTIVE' });
const listCoursework = (token, courseId) => classroomGet(token, `/courses/${courseId}/courseWork`, 'courseWork');
const listAnnouncements = (token, courseId) => classroomGet(token, `/courses/${courseId}/announcements`, 'announcements');

/** Classroom returns dates as parts; this turns them into 'YYYY-MM-DD'. */
function dueDateOf(work) {
  const d = work.dueDate;
  if (!d || !d.year || !d.month || !d.day) return null;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** Builds a short course code from a Classroom course, e.g. "CS301" or "MATHS-1". */
function courseCodeOf(course) {
  const fromSection = (course.section || '').match(/\b([A-Z]{2,4}[\s-]?\d{2,4})\b/);
  const fromName = (course.name || '').match(/\b([A-Z]{2,4}[\s-]?\d{2,4})\b/);
  const code = (fromSection || fromName || [])[1];
  if (code) return code.replace(/[\s-]/g, '').slice(0, 20);
  return (course.name || 'COURSE')
    .split(/\s+/).map(w => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'COURSE';
}

module.exports = {
  isConfigured, authUrl, exchangeCode, refreshAccessToken, fetchProfile,
  listCourses, listCoursework, listAnnouncements, dueDateOf, courseCodeOf, SCOPES, redirectUri,
};
