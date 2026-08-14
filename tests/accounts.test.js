const { test } = require('node:test');
const assert = require('node:assert');
const {
  validateUsername, validateEmail, validatePassword, passwordStrength,
  normalizeUsername, usernameFromEmail,
} = require('../src/lib/accounts');

test('usernames are case-insensitive and trimmed', () => {
  assert.equal(normalizeUsername('  Vansh_V  '), 'vansh_v');
  assert.equal(validateUsername('VANSH_V').value, 'vansh_v');
});

test('username rules', () => {
  assert.equal(validateUsername('ab').ok, false, 'too short');
  assert.equal(validateUsername('a'.repeat(21)).ok, false, 'too long');
  assert.equal(validateUsername('has space').ok, false);
  assert.equal(validateUsername('has-dash').ok, false);
  assert.equal(validateUsername('good_name9').ok, true);
  assert.equal(validateUsername('').ok, false);
});

test('email rules', () => {
  assert.equal(validateEmail('v.vijayvargiya@somaiya.edu').value, 'v.vijayvargiya@somaiya.edu');
  assert.equal(validateEmail('  UPPER@Example.COM ').value, 'upper@example.com');
  assert.equal(validateEmail('not-an-email').ok, false);
  assert.equal(validateEmail('missing@domain').ok, false);
});

test('password rules reject weak values', () => {
  assert.equal(validatePassword('short1').ok, false, 'under 8 characters');
  assert.equal(validatePassword('alllettersonly').ok, false, 'no digit');
  assert.equal(validatePassword('12345678').ok, false, 'no letter');
  assert.equal(validatePassword('password1').ok, false, 'too common');
  assert.equal(validatePassword('studyhub2026').ok, true);
});

test('password strength scores 0-4', () => {
  assert.equal(passwordStrength(''), 0);
  assert.equal(passwordStrength('abcdefg1'), 1);
  assert.ok(passwordStrength('Abcdefgh1234!') >= 3);
  assert.ok(passwordStrength('x'.repeat(40)) <= 4);
});

test('usernames derived from email are always legal', () => {
  assert.equal(validateUsername(usernameFromEmail('v.vijayvargiya@somaiya.edu')).ok, true);
  assert.equal(validateUsername(usernameFromEmail('a@b.com')).ok, true, 'short local part is padded');
  assert.equal(validateUsername(usernameFromEmail('!!!@b.com')).ok, true, 'junk falls back to a default');
});
