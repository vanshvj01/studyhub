const { test } = require('node:test');
const assert = require('node:assert');
const { toBuffer } = require('../src/lib/binary');

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic number

test('a Buffer passes straight through', () => {
  assert.equal(toBuffer(bytes), bytes);
});

test('a BSON Binary with a .value() accessor is unwrapped', () => {
  const binary = { _bsontype: 'Binary', value: () => bytes };
  assert.deepEqual(toBuffer(binary), bytes);
});

test('a BSON Binary exposing .buffer is unwrapped', () => {
  assert.deepEqual(toBuffer({ _bsontype: 'Binary', buffer: bytes }), bytes);
});

test('a Uint8Array is converted', () => {
  assert.deepEqual(toBuffer(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), bytes);
});

test('the JSON shape of a Buffer is converted', () => {
  assert.deepEqual(toBuffer(JSON.parse(JSON.stringify(bytes))), bytes);
});

test('nothing usable returns null rather than a broken response body', () => {
  assert.equal(toBuffer(null), null);
  assert.equal(toBuffer(undefined), null);
  assert.equal(toBuffer('not bytes'), null);
  assert.equal(toBuffer({}), null);
});
