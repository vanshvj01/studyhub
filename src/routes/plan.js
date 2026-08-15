// The study plan: assignments, exams and the syllabus portion for each exam in,
// a day-by-day schedule out. Recomputed per request so it always reflects
// current deadlines and how much of the syllabus is already known.
const express = require('express');
const { pool } = require('../config/db');
const { buildPlan, expandExams } = require('../lib/planner');
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
      `SELECT e.id, e.title, DATE_FORMAT(e.exam_date, '%Y-%m-%d') AS due, e.weight,
              e.course_id, c.code AS course_code
       FROM exams e LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ? AND e.exam_date >= CURDATE()`,
      [req.user.id]
    );

    // For each exam: the topics explicitly marked as its portion, or — when the
    // student hasn't set one — the whole syllabus for that course.
    for (const exam of exams) {
      const [scoped] = await pool.execute(
        `SELECT t.id, t.title, t.unit, t.difficulty, t.status, t.order_index AS orderIndex
         FROM exam_topics et JOIN syllabus_topics t ON t.id = et.topic_id
         WHERE et.exam_id = ? ORDER BY t.order_index, t.id`,
        [exam.id]
      );
      if (scoped.length) {
        exam.topics = scoped;
        exam.portionSet = true;
      } else if (exam.course_id) {
        const [all] = await pool.execute(
          `SELECT id, title, unit, difficulty, status, order_index AS orderIndex
           FROM syllabus_topics WHERE user_id = ? AND course_id = ? ORDER BY order_index, id`,
          [req.user.id, exam.course_id]
        );
        exam.topics = all;
        exam.portionSet = false;
      } else {
        exam.topics = [];
        exam.portionSet = false;
      }
      exam.courseCode = exam.course_code;
    }

    const items = [
      ...assignments.map(a => ({
        id: `a${a.id}`, type: 'assignment', title: a.title, due: a.due, courseCode: a.course_code,
      })),
      ...expandExams(exams),
    ];

    const [[logged]] = await pool.execute(
      'SELECT COALESCE(SUM(minutes),0) AS m FROM study_sessions WHERE user_id = ? AND studied_on = CURDATE()',
      [req.user.id]
    );

    const plan = buildPlan(items, { dailyMinutes, horizonDays });
    res.json({
      ...plan,
      dailyMinutes,
      horizonDays,
      studiedToday: Number(logged.m),
      exams: exams.map(e => ({
        id: e.id, title: e.title, due: e.due, courseCode: e.courseCode,
        topicCount: e.topics.length, portionSet: e.portionSet,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
