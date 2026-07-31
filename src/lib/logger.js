// Structured logging. Pretty single lines in development, JSON in production
// so the output can be shipped to a log aggregator without reparsing.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configured = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const asJson = process.env.NODE_ENV === 'production';

function emit(level, msg, meta = {}) {
  if (LEVELS[level] > configured) return;
  const time = new Date().toISOString();
  if (asJson) {
    console[level === 'debug' ? 'log' : level](JSON.stringify({ time, level, msg, ...meta }));
    return;
  }
  const tail = Object.keys(meta).length ? ' ' + Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(' ') : '';
  console[level === 'debug' ? 'log' : level](`${time.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`);
}

const logger = {
  error: (m, meta) => emit('error', m, meta),
  warn:  (m, meta) => emit('warn', m, meta),
  info:  (m, meta) => emit('info', m, meta),
  debug: (m, meta) => emit('debug', m, meta),
};

/** Logs method, path, status and duration for every API request. */
function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    emit(level, `${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      ms: ms.toFixed(1),
      user: req.user?.id ?? '-',
    });
  });
  next();
}

module.exports = { logger, requestLogger };
