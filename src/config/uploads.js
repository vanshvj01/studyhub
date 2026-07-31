// Minimal base64 -> disk helper. Keeping uploads dependency-free (no multer)
// means the client can post JSON with data URLs and nothing else changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file

const EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/markdown': '.md',
};

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Accepts { name, dataUrl } where dataUrl looks like "data:image/png;base64,AAA..."
function saveDataUrl({ name, dataUrl }) {
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!match) throw Object.assign(new Error('Invalid file data'), { status: 400 });

  const [, mime, b64] = match;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_BYTES) {
    throw Object.assign(new Error(`"${name}" is larger than 8 MB`), { status: 413 });
  }
  if (!EXT[mime]) {
    throw Object.assign(new Error(`Unsupported file type: ${mime}`), { status: 415 });
  }

  ensureDir();
  const filename = crypto.randomBytes(12).toString('hex') + EXT[mime];
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);

  return {
    name: String(name || 'file').slice(0, 120),
    url: `/uploads/${filename}`,
    type: mime,
    size: buf.length,
  };
}

module.exports = { saveDataUrl, UPLOAD_DIR };
