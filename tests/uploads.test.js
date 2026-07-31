const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { saveDataUrl, UPLOAD_DIR } = require('../src/config/uploads');

const dataUrl = (mime, text) => `data:${mime};base64,${Buffer.from(text).toString('base64')}`;

test('writes an allowed file and returns its metadata', () => {
  const meta = saveDataUrl({ name: 'notes.png', dataUrl: dataUrl('image/png', 'hello') });
  assert.equal(meta.name, 'notes.png');
  assert.equal(meta.type, 'image/png');
  assert.equal(meta.size, 5);
  assert.match(meta.url, /^\/uploads\/[a-f0-9]{24}\.png$/);
  const written = path.join(UPLOAD_DIR, path.basename(meta.url));
  assert.ok(fs.existsSync(written));
  fs.unlinkSync(written);
});

test('rejects executables and other unsupported types', () => {
  assert.throws(
    () => saveDataUrl({ name: 'virus.exe', dataUrl: dataUrl('application/x-msdownload', 'MZ') }),
    e => e.status === 415
  );
});

test('rejects anything that is not a data URL', () => {
  assert.throws(() => saveDataUrl({ name: 'x', dataUrl: 'https://example.com/x.png' }), e => e.status === 400);
  assert.throws(() => saveDataUrl({ name: 'x', dataUrl: '' }), e => e.status === 400);
});

test('rejects files over the size limit', () => {
  const big = 'data:image/png;base64,' + Buffer.alloc(9 * 1024 * 1024).toString('base64');
  assert.throws(() => saveDataUrl({ name: 'big.png', dataUrl: big }), e => e.status === 413);
});

test('truncates absurdly long filenames', () => {
  const meta = saveDataUrl({ name: 'a'.repeat(400) + '.png', dataUrl: dataUrl('image/png', 'x') });
  assert.equal(meta.name.length, 120);
  fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(meta.url)));
});
