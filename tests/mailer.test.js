const { test } = require('node:test');
const assert = require('node:assert');
const { verificationEmail, transport, autoVerifyEnabled } = require('../src/lib/mailer');

const withEnv = (vars, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

test('transport falls back to logging without an API key', () => {
  withEnv({ RESEND_API_KEY: null }, () => assert.equal(transport(), 'log'));
  withEnv({ RESEND_API_KEY: 're_test' }, () => assert.equal(transport(), 'resend'));
});

test('auto-verify is off unless explicitly enabled', () => {
  withEnv({ AUTO_VERIFY: null }, () => assert.equal(autoVerifyEnabled(), false));
  withEnv({ AUTO_VERIFY: 'false' }, () => assert.equal(autoVerifyEnabled(), false));
  withEnv({ AUTO_VERIFY: 'TRUE' }, () => assert.equal(autoVerifyEnabled(), true));
});

test('the verification email carries the link in both formats', () => {
  const url = 'https://studyhub.example/api/auth/verify?token=abc123';
  const mail = verificationEmail({ name: 'Vansh Vijayvargiya', url });
  assert.match(mail.subject, /verify/i);
  assert.ok(mail.html.includes(url), 'html contains the link');
  assert.ok(mail.text.includes(url), 'plain text contains the link');
  assert.ok(mail.text.length > 40, 'plain text alternative is not empty');
});

test('it greets by first name only', () => {
  assert.match(verificationEmail({ name: 'Vansh Vijayvargiya', url: 'https://x/y' }).html, /Hi Vansh,/);
  assert.match(verificationEmail({ name: '', url: 'https://x/y' }).html, /Hi there,/);
});

test('names and urls are escaped, so a display name cannot inject markup', () => {
  const mail = verificationEmail({ name: '<script>alert(1)</script> Bob', url: 'https://x/y?a=1&b=2' });
  assert.ok(!mail.html.includes('<script>'), 'script tag must not survive');
  assert.ok(mail.html.includes('&amp;'), 'ampersand in the url is escaped');
});
