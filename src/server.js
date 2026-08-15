require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const { loadEnv } = require('./config/env');
const { logger, requestLogger } = require('./lib/logger');
const { connectMongo, pingMySQL } = require('./config/db');
const { initDb } = require('./config/initDb');
const { attachRealtime } = require('./realtime');
const { startScheduler } = require('./scheduler');

const env = loadEnv();

const app = express();
app.disable('x-powered-by');
// Behind Render/Heroku/nginx the app sees http; this makes req.protocol honest
// so generated links use https.
app.set('trust proxy', 1);
app.use(cors({ origin: env.corsOrigin }));
// generous limit: note attachments and avatars arrive as base64 data URLs
app.use(express.json({ limit: '25mb' }));
app.use('/api', requestLogger);
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
app.use('/api/files', require('./routes/files'));
app.use('/api/parents', require('./routes/parents'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/chat', require('./routes/chat'));   // includes /api/chat/rooms/*
app.use('/api/exams', require('./routes/exams'));
app.use('/api/plan', require('./routes/plan'));
app.use('/api/syllabus', require('./routes/syllabus'));
app.use('/api/classroom', require('./routes/classroom'));

// Used by the host's health check, and to wake the instance after it sleeps
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));

// unknown API routes answer with JSON, not the SPA's HTML
app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

// central error handler — client errors keep their message, server errors do not leak internals
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) logger.error(err.message, { stack: err.stack?.split('\n')[1]?.trim() });
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

const server = http.createServer(app);

async function start() {
  try {
    await Promise.all([pingMySQL(), connectMongo()]);
    await initDb();
    attachRealtime(server, app, env.corsOrigin);
    startScheduler();
    server.listen(env.port, () => logger.info(`StudyHub listening on port ${env.port}`, { env: env.nodeEnv }));
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

module.exports = { app, server, start };
