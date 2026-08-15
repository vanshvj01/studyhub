const { test } = require('node:test');
const assert = require('node:assert');
const { parseCookies, tokenFromRequest, cookieOptions, COOKIE_NAME } = require('../src/lib/cookies');

test('parses a normal cookie header', () => {
  assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
});

test('copes with the messy headers browsers actually send', () => {
  assert.deepEqual(parseCookies('  a = 1 ;;  b=2  '), { a: '1', b: '2' });
  assert.deepEqual(parseCookies('a="quoted"'), { a: 'quoted' });
  assert.deepEqual(parseCookies('a=1; a=2'), { a: '1' }, 'first occurrence wins');
  assert.deepEqual(parseCookies('novalue'), {});
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('decodes encoded values, and survives malformed ones', () => {
  assert.equal(parseCookies('t=a%20b').t, 'a b');
  assert.equal(parseCookies('t=%E0%A4').t, '%E0%A4', 'invalid encoding is returned as-is');
});

test('a cookie value containing = is kept intact', () => {
  // JWTs are base64url so they do not contain '=', but padding must not break us
  assert.equal(parseCookies('t=aaa.bbb.ccc==').t, 'aaa.bbb.ccc==');
});

test('the Authorization header wins over the cookie', () => {
  const req = { headers: { authorization: 'Bearer header-token', cookie: `${COOKIE_NAME}=cookie-token` } };
  assert.equal(tokenFromRequest(req), 'header-token');
});

test('the cookie is used when there is no header', () => {
  assert.equal(tokenFromRequest({ headers: { cookie: `${COOKIE_NAME}=cookie-token` } }), 'cookie-token');
});

test('an empty or malformed header falls through to the cookie', () => {
  const req = { headers: { authorization: 'Bearer ', cookie: `${COOKIE_NAME}=cookie-token` } };
  assert.equal(tokenFromRequest(req), 'cookie-token');
  assert.equal(tokenFromRequest({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(tokenFromRequest({ headers: {} }), null);
  assert.equal(tokenFromRequest({}), null);
});

test('the cookie is httpOnly and lax, and https-only in production', () => {
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    const dev = cookieOptions();
    assert.equal(dev.httpOnly, true, 'JavaScript must never read the session');
    assert.equal(dev.sameSite, 'lax', 'blocks cross-site POSTs');
    assert.equal(dev.secure, false, 'http works locally');

    process.env.NODE_ENV = 'production';
    assert.equal(cookieOptions().secure, true, 'https only once deployed');
  } finally {
    process.env.NODE_ENV = saved;
  }
});
