// Small declarative request validator. Keeps route handlers free of
// hand-rolled `if (!x) return res.status(400)` chains and gives every
// endpoint the same error shape: { error, errors: [...] }.

const isPlainDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * @param {object} input  raw req.body / req.query
 * @param {object} schema { field: { type, required, min, max, maxLen, values, default } }
 * @returns {{ value: object, errors: string[] }}
 */
function check(input, schema) {
  const source = input && typeof input === 'object' ? input : {};
  const value = {};
  const errors = [];

  for (const [field, spec] of Object.entries(schema)) {
    let raw = source[field];
    const missing = raw === undefined || raw === null || raw === '';

    if (missing) {
      if (spec.required) { errors.push(`${field} is required`); continue; }
      if (spec.default !== undefined) value[field] = spec.default;
      continue;
    }

    switch (spec.type) {
      case 'string': {
        let v = String(raw);
        if (spec.trim !== false) v = v.trim();
        if (v === '' && spec.required) { errors.push(`${field} is required`); continue; }
        if (spec.maxLen && v.length > spec.maxLen) { errors.push(`${field} must be ${spec.maxLen} characters or fewer`); continue; }
        if (spec.minLen && v.length < spec.minLen) { errors.push(`${field} must be at least ${spec.minLen} characters`); continue; }
        value[field] = v;
        break;
      }
      case 'int':
      case 'number': {
        const v = spec.type === 'int' ? Number.parseInt(raw, 10) : Number(raw);
        if (!Number.isFinite(v)) { errors.push(`${field} must be a number`); continue; }
        if (spec.min !== undefined && v < spec.min) { errors.push(`${field} must be at least ${spec.min}`); continue; }
        if (spec.max !== undefined && v > spec.max) { errors.push(`${field} must be at most ${spec.max}`); continue; }
        value[field] = v;
        break;
      }
      case 'enum': {
        const v = String(raw);
        if (!spec.values.includes(v)) { errors.push(`${field} must be one of: ${spec.values.join(', ')}`); continue; }
        value[field] = v;
        break;
      }
      case 'date': {
        if (!isPlainDate(raw)) { errors.push(`${field} must be a date in YYYY-MM-DD format`); continue; }
        value[field] = raw;
        break;
      }
      case 'bool': {
        value[field] = raw === true || raw === 'true' || raw === 1 || raw === '1';
        break;
      }
      case 'array': {
        if (!Array.isArray(raw)) { errors.push(`${field} must be a list`); continue; }
        if (spec.maxItems && raw.length > spec.maxItems) { errors.push(`${field} accepts at most ${spec.maxItems} items`); continue; }
        value[field] = raw;
        break;
      }
      default:
        value[field] = raw;
    }
  }

  return { value, errors };
}

/** Express middleware factory. Validated values replace req.body / req.query. */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { value, errors } = check(req[source], schema);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    req[source] = { ...req[source], ...value };
    next();
  };
}

module.exports = { check, validate };
