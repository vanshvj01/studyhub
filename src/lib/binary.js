// Turning whatever MongoDB hands back into a real Buffer.
//
// A lean() query skips Mongoose's casting, so a stored Buffer comes back as a
// BSON Binary — an object, not a Buffer. Passing that to res.send() serialises
// it as JSON, which is how an image ends up "loading" as a wall of numbers.
function toBuffer(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;

  // BSON Binary: { _bsontype: 'Binary', buffer: <Buffer> } (and .value() in some versions)
  if (typeof value.value === 'function') {
    const inner = value.value(true);
    if (Buffer.isBuffer(inner)) return inner;
  }
  if (value.buffer && Buffer.isBuffer(value.buffer)) return value.buffer;
  if (value instanceof Uint8Array) return Buffer.from(value);

  // { type: 'Buffer', data: [...] } — the shape a Buffer takes after JSON.parse
  if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  if (Array.isArray(value)) return Buffer.from(value);

  return null;
}

module.exports = { toBuffer };
