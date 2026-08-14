// Dependency-free base64 upload handling. The client posts data URLs inside
// ordinary JSON; this module validates them and stores the bytes in MongoDB.
//
// Storing files in the database rather than on disk means no volume to mount
// and nothing to lose on redeploy: hosting containers are rebuilt from the
// image on every push, so anything written to the filesystem disappears.
const Attachment = require('../models/Attachment');

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file

const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
};

/** Parses and validates a data URL without touching the database. */
function parseDataUrl({ name, dataUrl }) {
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!match) throw Object.assign(new Error('Invalid file data'), { status: 400 });

  const [, type, b64] = match;
  if (!ALLOWED[type]) {
    throw Object.assign(new Error(`Unsupported file type: ${type}`), { status: 415 });
  }
  const data = Buffer.from(b64, 'base64');
  if (data.length > MAX_BYTES) {
    throw Object.assign(new Error(`"${name}" is larger than 8 MB`), { status: 413 });
  }
  return { name: String(name || 'file').slice(0, 120), type, size: data.length, data };
}

/** Validates, stores, and returns the metadata a note keeps alongside it. */
async function saveUpload({ name, dataUrl }, ownerId) {
  const parsed = parseDataUrl({ name, dataUrl });
  const doc = await Attachment.create({ ...parsed, ownerId });
  return { name: doc.name, url: `/api/files/${doc._id}`, type: doc.type, size: doc.size };
}

module.exports = { saveUpload, parseDataUrl, ALLOWED, MAX_BYTES };
