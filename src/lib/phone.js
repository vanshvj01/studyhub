// Phone numbers are stored in a single canonical form so "+91 98765 43210",
// "098765 43210" and "9876543210" all resolve to the same account.
const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '+91';

/**
 * Returns E.164-ish digits with a leading +, or null when the input cannot be
 * a phone number. Deliberately permissive about formatting, strict about length.
 */
function normalizePhone(raw, defaultCode = DEFAULT_COUNTRY_CODE) {
  if (raw === undefined || raw === null) return null;
  let value = String(raw).trim();
  if (!value) return null;

  const hasPlus = value.startsWith('+') || value.startsWith('00');
  value = value.replace(/^00/, '+');
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;

  let out;
  if (hasPlus) {
    out = `+${digits}`;
  } else if (digits.length > 10 && digits.startsWith('0')) {
    out = `${defaultCode}${digits.replace(/^0+/, '')}`;   // 0-prefixed national form
  } else if (digits.length === 10) {
    out = `${defaultCode}${digits}`;                       // bare national number
  } else if (digits.length === 11 && digits.startsWith('0')) {
    out = `${defaultCode}${digits.slice(1)}`;
  } else {
    out = `+${digits}`;
  }

  const bare = out.slice(1);
  if (bare.length < 8 || bare.length > 15) return null;    // E.164 bounds
  return out;
}

const looksLikePhone = raw => /^[+\d][\d\s\-()]{6,}$/.test(String(raw || '').trim());

module.exports = { normalizePhone, looksLikePhone, DEFAULT_COUNTRY_CODE };
