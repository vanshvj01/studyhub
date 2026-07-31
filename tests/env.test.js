const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// loadEnv calls process.exit on failure, so each case runs in its own process.
const run = env => {
  try {
    const out = execFileSync(process.execPath, ['-e', "require('./src/config/env').loadEnv(); console.log('OK')"], {
      cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: out.includes('OK'), out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

test('accepts a valid configuration', () => {
  assert.ok(run({ JWT_SECRET: 'x'.repeat(40) }).ok);
});

test('refuses to boot without JWT_SECRET', () => {
  const r = run({});
  assert.equal(r.ok, false);
  assert.match(r.out, /JWT_SECRET is not set/);
});

test('rejects a weak secret in production', () => {
  const r = run({ NODE_ENV: 'production', JWT_SECRET: 'change_me_to_a_long_random_string' });
  assert.equal(r.ok, false);
  assert.match(r.out, /too weak for production/);
});

test('rejects a non-numeric port and a bad Mongo URI', () => {
  assert.match(run({ JWT_SECRET: 'x'.repeat(40), PORT: 'abc' }).out, /PORT must be a positive number/);
  assert.match(run({ JWT_SECRET: 'x'.repeat(40), MONGO_URI: 'mysql://nope' }).out, /MONGO_URI must start with/);
});
