const { test } = require('node:test');
const assert = require('node:assert');
const { parseDataUrl, ALLOWED, MAX_BYTES } = require('../src/config/uploads');

const dataUrl = (mime, text) => `data:${mime};base64,${Buffer.from(text).toString('base64')}`;

test('parses an allowed file and returns its metadata', () => {
  const meta = parseDataUrl({ name: 'notes.png', dataUrl: dataUrl('image/png', 'hello') });
  assert.equal(meta.name, 'notes.png');
  assert.equal(meta.type, 'image/png');
  assert.equal(meta.size, 5);
  assert.ok(Buffer.isBuffer(meta.data));
});

test('rejects executables and other unsupported types', () => {
  assert.throws(
    () => parseDataUrl({ name: 'virus.exe', dataUrl: dataUrl('application/x-msdownload', 'MZ') }),
    e => e.status === 415
  );
});

test('rejects anything that is not a data URL', () => {
  assert.throws(() => parseDataUrl({ name: 'x', dataUrl: 'https://example.com/x.png' }), e => e.status === 400);
  assert.throws(() => parseDataUrl({ name: 'x', dataUrl: '' }), e => e.status === 400);
  assert.throws(() => parseDataUrl({ name: 'x' }), e => e.status === 400);
});

test('rejects files over the size limit', () => {
  const big = 'data:image/png;base64,' + Buffer.alloc(MAX_BYTES + 1024).toString('base64');
  assert.throws(() => parseDataUrl({ name: 'big.png', dataUrl: big }), e => e.status === 413);
});

test('truncates absurdly long filenames', () => {
  const meta = parseDataUrl({ name: 'a'.repeat(400) + '.png', dataUrl: dataUrl('image/png', 'x') });
  assert.equal(meta.name.length, 120);
});

test('the allowlist contains no executable types', () => {
  for (const type of Object.keys(ALLOWED)) {
    assert.ok(/^(image|text)\//.test(type) || type === 'application/pdf', `${type} should not be allowed`);
  }
});
