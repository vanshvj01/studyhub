require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { loadEnv } = require('./config/env');
const { logger, requestLogger } = require('./lib/logger');
const { connectMongo, pingMySQL } = require('./config/db');
const { initDb } = require('./config/initDb');
const { UPLOAD_DIR, ensureDir } = require('./config/uploads');

const env = loadEnv();

const app = express();
app.disable('x-powered-by');
app.use(cors());
// generous limit: note attachments and avatars arrive as base64 data URLs
app.use(express.json({ limit: '25mb' }));
app.use('/api', requestLogger);
// Served before the public/ handler so that when UPLOAD_DIR points at a mounted
// volume, /uploads/* resolves to the volume rather than 404ing on the image built
// at deploy time. With the default UPLOAD_DIR the two paths are the same folder.
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/decks', require('./routes/decks'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/grades', require('./routes/grades'));
app.use('/api/search', require('./routes/search'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));

// unknown API routes answer with JSON, not the SPA's HTML
app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

// central error handler — client errors keep their message, server errors do not leak internals
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) logger.error(err.message, { stack: err.stack?.split('\n')[1]?.trim() });
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

async function start() {
  try {
    ensureDir(); // a freshly mounted volume starts empty
    await Promise.all([pingMySQL(), connectMongo()]);
    await initDb();
    app.listen(env.port, () => logger.info(`StudyHub listening on port ${env.port}`, { env: env.nodeEnv, uploads: UPLOAD_DIR }));
  } catch (err) {
    logger.error('Startup failed — are MySQL and MongoDB running? (docker compose up -d)');
    logger.error(err.message);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { logger.info(`${signal} received, shutting down`); process.exit(0); });
}

if (require.main === module) start();

module.exports = { app, start };
