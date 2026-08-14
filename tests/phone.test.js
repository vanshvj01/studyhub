const { test } = require('node:test');
const assert = require('node:assert');
const { normalizePhone, looksLikePhone } = require('../src/lib/phone');

test('different ways of writing one number resolve to the same value', () => {
  const expected = '+919876543210';
  for (const input of ['9876543210', '+91 98765 43210', '+91-9876543210', '09876543210', '0091 9876543210']) {
    assert.equal(normalizePhone(input), expected, `failed for ${input}`);
  }
});

test('international numbers keep their own country code', () => {
  assert.equal(normalizePhone('+1 (415) 555-2671'), '+14155552671');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
});

test('rubbish input returns null rather than a broken number', () => {
  for (const input of ['', '   ', null, undefined, 'not a phone', '123']) {
    assert.equal(normalizePhone(input), null, `failed for ${JSON.stringify(input)}`);
  }
});

test('absurdly long input is rejected', () => {
  assert.equal(normalizePhone('+' + '9'.repeat(20)), null);
});

test('looksLikePhone distinguishes a number from a username or email', () => {
  assert.equal(looksLikePhone('+91 98765 43210'), true);
  assert.equal(looksLikePhone('9876543210'), true);
  assert.equal(looksLikePhone('vansh_v'), false);
  assert.equal(looksLikePhone('v@somaiya.edu'), false);
});
