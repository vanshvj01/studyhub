// The study plan: assignments and exams in, a day-by-day schedule out.
// Recomputed on every request so it always reflects current deadlines.
const express = require('express');
const { pool } = require('../config/db');
const { buildPlan } = require('../lib/planner');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

// GET /api/plan?days=14&minutes=
router.get('/', async (req, res, next) => {
  try {
    const horizonDays = Math.min(Math.max(Number(req.query.days) || 14, 3), 60);

    const [[goal]] = await pool.execute('SELECT daily_goal_minutes FROM users WHERE id = ?', [req.user.id]);
    const dailyMinutes = Number(req.query.minutes) || Number(goal?.daily_goal_minutes) || 60;

    const [assignments] = await pool.execute(
      `SELECT a.id, a.title, DATE_FORMAT(a.due_date, '%Y-%m-%d') AS due, c.code AS course_code
       FROM assignments a JOIN courses c ON c.id = a.course_id
       WHERE a.user_id = ? AND a.status = 'pending' AND a.due_date >= CURDATE()`,
      [req.user.id]
    );

    const [exams] = await pool.execute(
      `SELECT e.id, e.title, DATE_FORMAT(e.exam_date, '%Y-%m-%d') AS due, e.weight, c.code AS course_code
       FROM exams e LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ? AND e.exam_date >= CURDATE()`,
      [req.user.id]
    );

    const items = [
      ...assignments.map(a => ({ id: `a${a.id}`, type: 'assignment', title: a.title, due: a.due, courseCode: a.course_code })),
      ...exams.map(e => ({ id: `e${e.id}`, type: 'exam', title: e.title, due: e.due, weight: e.weight, courseCode: e.course_code })),
    ];

    // How much has already been studied today, so the plan reflects reality.
    const [[logged]] = await pool.execute(
      'SELECT COALESCE(SUM(minutes),0) AS m FROM study_sessions WHERE user_id = ? AND studied_on = CURDATE()',
      [req.user.id]
    );

    const plan = buildPlan(items, { dailyMinutes, horizonDays });
    res.json({ ...plan, dailyMinutes, horizonDays, studiedToday: Number(logged.m) });
  } catch (err) { next(err); }
});

module.exports = router;
