// Short human-friendly codes for invites and referrals.
// Crockford-style alphabet: no I, L, O, U — nothing a person can misread.
const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function shortCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const token = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');

module.exports = { shortCode, token, ALPHABET };
