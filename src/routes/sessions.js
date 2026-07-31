// Study timer sessions + the daily streak derived from them.
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { computeStreak } = require('../lib/streak');

const router = express.Router();
router.use(requireAuth);

// GET /api/sessions/stats — today, week, streak, per-day chart data
router.get('/stats', async (req, res, next) => {
  try {
    const [[totals]] = await pool.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN studied_on = CURDATE() THEN minutes END), 0)                        AS todayMinutes,
         COALESCE(SUM(CASE WHEN studied_on >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN minutes END), 0) AS weekMinutes,
         COALESCE(SUM(minutes), 0)                                                                  AS totalMinutes,
         COUNT(*)                                                                                   AS sessionCount
       FROM study_sessions WHERE user_id = ?`,
      [req.user.id]
    );

    const [days] = await pool.execute(
      `SELECT DATE_FORMAT(studied_on, '%Y-%m-%d') AS day, SUM(minutes) AS minutes
       FROM study_sessions
       WHERE user_id = ? AND studied_on >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY studied_on ORDER BY studied_on`,
      [req.user.id]
    );

    const [streakRows] = await pool.execute(
      // Order by the aliased column, not the raw one: with DISTINCT, MySQL's
      // ONLY_FULL_GROUP_BY rejects an ORDER BY column that isn't selected.
      `SELECT DISTINCT DATE_FORMAT(studied_on, '%Y-%m-%d') AS day
       FROM study_sessions WHERE user_id = ? ORDER BY day DESC LIMIT 400`,
      [req.user.id]
    );

    const [[goal]] = await pool.execute(
      'SELECT daily_goal_minutes FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({
      todayMinutes: Number(totals.todayMinutes),
      weekMinutes: Number(totals.weekMinutes),
      totalMinutes: Number(totals.totalMinutes),
      sessionCount: Number(totals.sessionCount),
      dailyGoal: Number(goal?.daily_goal_minutes || 60),
      streak: computeStreak(streakRows.map(r => r.day)),
      last7: days.map(d => ({ day: d.day, minutes: Number(d.minutes) })),
    });
  } catch (err) { next(err); }
});

// POST /api/sessions { minutes, courseId? } — log a finished timer session
router.post('/', validate({
  minutes: { type: 'int', required: true, min: 1, max: 600 },
  courseId: { type: 'int' },
}), async (req, res, next) => {
  try {
    const { minutes } = req.body;
    const courseId = req.body.courseId ?? null;
    await pool.execute(
      'INSERT INTO study_sessions (user_id, course_id, minutes, studied_on) VALUES (?, ?, ?, CURDATE())',
      [req.user.id, courseId, minutes]
    );
    res.status(201).json({ message: 'Session logged', minutes });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Course not found' });
    next(err);
  }
});

// GET /api/sessions/recent — last logged sessions, for the history list
router.get('/recent', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.id, s.minutes, s.studied_on, s.created_at, c.code AS course_code
       FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 12`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/sessions/leaderboard — who studied most in the last 7 days
router.get('/leaderboard', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.avatar,
              COALESCE(SUM(s.minutes), 0) AS minutes,
              COUNT(DISTINCT s.studied_on) AS active_days
       FROM users u
       LEFT JOIN study_sessions s
         ON s.user_id = u.id AND s.studied_on >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY u.id, u.name, u.avatar
       HAVING minutes > 0 OR u.id = ?
       ORDER BY minutes DESC, u.name ASC
       LIMIT 25`,
      [req.user.id]
    );
    res.json(rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      minutes: Number(r.minutes),
      activeDays: Number(r.active_days),
      isMe: r.id === req.user.id,
    })));
  } catch (err) { next(err); }
});

module.exports = router;
