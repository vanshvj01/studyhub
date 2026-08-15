// Parent (guardian) accounts. Deliberately read-only: a parent can see
// progress summaries for linked children and nothing else — no notes, no chat,
// no ability to change anything the student owns.
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { computeStreak } = require('../lib/streak');
const { letterFor, weightedAverage, percentOf } = require('../lib/marks');

const router = express.Router();
router.use(requireAuth, requireRole('parent'));

async function summariseStudent(studentId) {
  const [[totals]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM enrollments WHERE user_id = ?)                       AS courses,
       (SELECT COUNT(*) FROM progress WHERE user_id = ?)                          AS topics,
       (SELECT COUNT(*) FROM progress WHERE user_id = ? AND status = 'completed') AS topicsDone,
       (SELECT COUNT(*) FROM assignments WHERE user_id = ? AND status = 'pending'
          AND archived_at IS NULL AND due_date < CURDATE())                       AS overdue,
       (SELECT COUNT(*) FROM assignments WHERE user_id = ? AND status = 'pending'
          AND archived_at IS NULL)                                                AS openAssignments,
       (SELECT COALESCE(SUM(minutes),0) FROM study_sessions WHERE user_id = ?
          AND studied_on >= DATE_SUB(CURDATE(), INTERVAL 6 DAY))                   AS weekMinutes,
       (SELECT COALESCE(SUM(minutes),0) FROM study_sessions WHERE user_id = ?
          AND studied_on = CURDATE())                                             AS todayMinutes`,
    Array(7).fill(studentId)
  );

  const [streakRows] = await pool.execute(
    `SELECT DISTINCT DATE_FORMAT(studied_on, '%Y-%m-%d') AS day
     FROM study_sessions WHERE user_id = ? ORDER BY day DESC LIMIT 400`,
    [studentId]
  );

  const [days] = await pool.execute(
    `SELECT DATE_FORMAT(studied_on, '%Y-%m-%d') AS day, SUM(minutes) AS minutes
     FROM study_sessions WHERE user_id = ? AND studied_on >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY studied_on ORDER BY studied_on`,
    [studentId]
  );

  return {
    courses: Number(totals.courses),
    topics: Number(totals.topics),
    topicsDone: Number(totals.topicsDone),
    progressPct: Number(totals.topics) ? Math.round(Number(totals.topicsDone) / Number(totals.topics) * 100) : 0,
    openAssignments: Number(totals.openAssignments),
    overdue: Number(totals.overdue),
    weekMinutes: Number(totals.weekMinutes),
    todayMinutes: Number(totals.todayMinutes),
    streak: computeStreak(streakRows.map(r => r.day)),
    last7: days.map(d => ({ day: d.day, minutes: Number(d.minutes) })),
  };
}

async function assertLinked(parentId, studentId) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM guardian_links WHERE parent_id = ? AND student_id = ?',
    [parentId, studentId]
  );
  if (rows.length === 0) {
    const err = new Error('You are not linked to that student');
    err.status = 403;
    throw err;
  }
}

// GET /api/parents/children — overview cards
router.get('/children', async (req, res, next) => {
  try {
    const [children] = await pool.execute(
      `SELECT u.id, u.name, u.username, u.avatar, u.college, g.created_at AS linked_at
       FROM guardian_links g JOIN users u ON u.id = g.student_id
       WHERE g.parent_id = ? ORDER BY u.name`,
      [req.user.id]
    );
    const withStats = await Promise.all(
      children.map(async c => ({ ...c, stats: await summariseStudent(c.id) }))
    );
    res.json(withStats);
  } catch (err) { next(err); }
});

// GET /api/parents/children/:id — detail: per-course progress, deadlines, grades
router.get('/children/:id', async (req, res, next) => {
  try {
    const studentId = Number(req.params.id);
    await assertLinked(req.user.id, studentId);

    const [[student]] = await pool.execute(
      'SELECT id, name, username, avatar, college FROM users WHERE id = ?', [studentId]
    );

    const [courses] = await pool.execute(
      `SELECT c.id, c.code, c.title, c.semester,
              COUNT(p.id) AS total_topics,
              SUM(p.status = 'completed') AS completed_topics
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       LEFT JOIN progress p ON p.course_id = c.id AND p.user_id = e.user_id
       WHERE e.user_id = ? AND c.archived_at IS NULL
       GROUP BY c.id, c.code, c.title, c.semester ORDER BY c.code`,
      [studentId]
    );

    const [assignments] = await pool.execute(
      `SELECT a.id, a.title, a.due_date, a.status, c.code AS course_code,
              DATEDIFF(a.due_date, CURDATE()) AS days_left
       FROM assignments a JOIN courses c ON c.id = a.course_id
       WHERE a.user_id = ? AND a.status = 'pending' AND a.archived_at IS NULL
       ORDER BY a.due_date LIMIT 20`,
      [studentId]
    );

    const [marks] = await pool.execute(
      `SELECT g.course_id, g.score, g.max_score, g.weight, c.code AS course_code, c.title AS course_title
       FROM grades g JOIN courses c ON c.id = g.course_id WHERE g.user_id = ?`,
      [studentId]
    );

    const byCourse = new Map();
    for (const m of marks) {
      if (!byCourse.has(m.course_id)) {
        byCourse.set(m.course_id, { code: m.course_code, title: m.course_title, items: [] });
      }
      byCourse.get(m.course_id).items.push({ pct: percentOf(m.score, m.max_score), weight: Number(m.weight) });
    }
    const grades = [...byCourse.values()].map(c => {
      const average = weightedAverage(c.items);
      return { code: c.code, title: c.title, average, grade: letterFor(average), count: c.items.length };
    });

    res.json({
      student,
      stats: await summariseStudent(studentId),
      courses: courses.map(c => {
        const total = Number(c.total_topics) || 0;
        const done = Number(c.completed_topics) || 0;
        return { id: c.id, code: c.code, title: c.title, semester: c.semester,
                 totalTopics: total, completedTopics: done,
                 progressPct: total ? Math.round(done / total * 100) : 0 };
      }),
      assignments,
      grades,
    });
  } catch (err) { next(err); }
});

// POST /api/parents/link { code } — redeem a student's invite code
router.post('/link', validate({ code: { type: 'string', required: true, maxLen: 8 } }), async (req, res, next) => {
  try {
    const code = req.body.code.toUpperCase();
    const [rows] = await pool.execute(
      'SELECT code, student_id, expires_at, used_by FROM student_invites WHERE code = ?', [code]
    );
    const invite = rows[0];
    if (!invite) return res.status(404).json({ error: 'That invite code is not valid' });
    if (invite.used_by) return res.status(409).json({ error: 'That invite code has already been used' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'That invite code has expired' });

    await pool.execute(
      'INSERT IGNORE INTO guardian_links (parent_id, student_id) VALUES (?, ?)',
      [req.user.id, invite.student_id]
    );
    await pool.execute(
      'UPDATE student_invites SET used_by = ?, used_at = NOW() WHERE code = ?',
      [req.user.id, code]
    );

    const [[student]] = await pool.execute('SELECT name FROM users WHERE id = ?', [invite.student_id]);
    res.status(201).json({ message: `Linked to ${student?.name || 'student'}` });
  } catch (err) { next(err); }
});

// DELETE /api/parents/children/:id — unlink
router.delete('/children/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM guardian_links WHERE parent_id = ? AND student_id = ?',
      [req.user.id, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not linked to that student' });
    res.json({ message: 'Unlinked' });
  } catch (err) { next(err); }
});

module.exports = router;
