const { test } = require('node:test');
const assert = require('node:assert');
const { shortCode, token, ALPHABET } = require('../src/lib/ids');

test('short codes have the requested length and safe alphabet', () => {
  const code = shortCode(8);
  assert.equal(code.length, 8);
  assert.ok([...code].every(c => ALPHABET.includes(c)));
});

test('the alphabet excludes characters people misread', () => {
  for (const c of ['I', 'L', 'O', 'U', '0', '1']) {
    assert.ok(!ALPHABET.includes(c), `${c} should not be in the alphabet`);
  }
});

test('codes do not collide in practice', () => {
  const seen = new Set(Array.from({ length: 2000 }, () => shortCode(8)));
  assert.ok(seen.size > 1990, `expected near-unique codes, got ${seen.size}`);
});

test('tokens are hex and long enough to be unguessable', () => {
  const t = token(24);
  assert.equal(t.length, 48);
  assert.match(t, /^[0-9a-f]+$/);
});
