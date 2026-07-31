const { test } = require('node:test');
const assert = require('node:assert');
const { check } = require('../src/lib/validate');

test('reports every missing required field', () => {
  const { errors } = check({}, { a: { type: 'string', required: true }, b: { type: 'int', required: true } });
  assert.deepEqual(errors, ['a is required', 'b is required']);
});

test('treats empty string as missing', () => {
  const { errors } = check({ name: '   ' }, { name: { type: 'string', required: true } });
  assert.equal(errors.length, 1);
});

test('trims strings but leaves passwords untouched', () => {
  const { value } = check(
    { name: '  Vansh  ', password: ' secret123 ' },
    { name: { type: 'string' }, password: { type: 'string', trim: false } }
  );
  assert.equal(value.name, 'Vansh');
  assert.equal(value.password, ' secret123 ');
});

test('enforces string length bounds', () => {
  assert.equal(check({ t: 'abcdef' }, { t: { type: 'string', maxLen: 3 } }).errors.length, 1);
  assert.equal(check({ p: 'short' }, { p: { type: 'string', minLen: 8 } }).errors.length, 1);
});

test('coerces and bounds numbers', () => {
  assert.equal(check({ n: '42' }, { n: { type: 'int' } }).value.n, 42);
  assert.equal(check({ n: 'abc' }, { n: { type: 'int' } }).errors[0], 'n must be a number');
  assert.equal(check({ n: 900 }, { n: { type: 'int', max: 600 } }).errors.length, 1);
  assert.equal(check({ n: -1 }, { n: { type: 'number', min: 0 } }).errors.length, 1);
});

test('validates enums and dates', () => {
  assert.equal(check({ s: 'done' }, { s: { type: 'enum', values: ['pending', 'done'] } }).errors.length, 0);
  assert.equal(check({ s: 'nope' }, { s: { type: 'enum', values: ['pending', 'done'] } }).errors.length, 1);
  assert.equal(check({ d: '2026-08-15' }, { d: { type: 'date' } }).errors.length, 0);
  assert.equal(check({ d: '15/08/2026' }, { d: { type: 'date' } }).errors.length, 1);
});

test('applies defaults only when the field is absent', () => {
  assert.equal(check({}, { w: { type: 'number', default: 1 } }).value.w, 1);
  assert.equal(check({ w: 2.5 }, { w: { type: 'number', default: 1 } }).value.w, 2.5);
});

test('caps array size', () => {
  assert.equal(check({ a: [1, 2, 3] }, { a: { type: 'array', maxItems: 2 } }).errors.length, 1);
  assert.equal(check({ a: 'nope' }, { a: { type: 'array' } }).errors[0], 'a must be a list');
});

test('ignores fields that are not in the schema', () => {
  const { value } = check({ role: 'admin', name: 'x' }, { name: { type: 'string' } });
  assert.deepEqual(Object.keys(value), ['name']);
});
