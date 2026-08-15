// Google Classroom import. Read-only: nothing is ever written back to Classroom.
const express = require('express');
const { pool } = require('../config/db');
const google = require('../lib/google');
const { syncUserClassroom, hasClassroomScope } = require('../lib/classroomSync');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { logger } = require('../lib/logger');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

const syncIntervalMinutes = () => Number(process.env.CLASSROOM_SYNC_MINUTES ?? 30);

// GET /api/classroom/status
router.get('/status', async (req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      `SELECT google_id, google_refresh_token, google_scopes, classroom_synced_at, classroom_auto_sync
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM courses WHERE source = 'classroom') AS courses,
         (SELECT COUNT(*) FROM assignments WHERE user_id = ? AND source = 'classroom') AS assignments`,
      [req.user.id]
    );
    const connected = Boolean(row?.google_refresh_token) && hasClassroomScope(row?.google_scopes);
    res.json({
      configured: google.isConfigured(),
      connected,
      googleLinked: Boolean(row?.google_id),
      lastSyncedAt: row?.classroom_synced_at || null,
      autoSync: connected && row?.classroom_auto_sync !== 0,
      autoSyncMinutes: syncIntervalMinutes(),
      imported: { courses: Number(counts.courses), assignments: Number(counts.assignments) },
    });
  } catch (err) { next(err); }
});

// POST /api/classroom/sync — the manual "Import now" button
router.post('/sync', async (req, res, next) => {
  try {
    if (!google.isConfigured()) {
      return res.status(503).json({ error: 'Google is not configured on this deployment' });
    }
    const summary = await syncUserClassroom(req.user.id);
    res.json({ message: 'Import finished', ...summary });
  } catch (err) {
    if (err.status === 403) {
      await pool.execute('UPDATE users SET google_scopes = NULL WHERE id = ?', [req.user.id]).catch(() => {});
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/classroom/settings { autoSync }
router.patch('/settings', validate({ autoSync: { type: 'bool', required: true } }), async (req, res, next) => {
  try {
    await pool.execute('UPDATE users SET classroom_auto_sync = ? WHERE id = ?',
      [req.body.autoSync ? 1 : 0, req.user.id]);
    logger.info('classroom auto-sync setting changed', { user: req.user.id, autoSync: req.body.autoSync });
    res.json({ autoSync: req.body.autoSync, everyMinutes: syncIntervalMinutes() });
  } catch (err) { next(err); }
});

// DELETE /api/classroom/connection
router.delete('/connection', async (req, res, next) => {
  try {
    await pool.execute(
      'UPDATE users SET google_refresh_token = NULL, google_scopes = NULL WHERE id = ?', [req.user.id]
    );
    res.json({ message: 'Google Classroom disconnected. Imported data stays.' });
  } catch (err) { next(err); }
});

module.exports = router;
