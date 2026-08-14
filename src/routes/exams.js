// Exams: entered by hand or pasted in from a timetable.
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { parseTimetable } = require('../lib/timetable');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

// GET /api/exams
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.title, e.exam_date, e.starts_at, e.weight, e.course_id,
              c.code AS course_code, DATEDIFF(e.exam_date, CURDATE()) AS days_left
       FROM exams e LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ?
       ORDER BY e.exam_date`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/exams { title, examDate, courseId?, startsAt?, weight? }
router.post('/', validate({
  title: { type: 'string', required: true, maxLen: 160 },
  examDate: { type: 'date', required: true },
  courseId: { type: 'int' },
  startsAt: { type: 'string', maxLen: 5 },
  weight: { type: 'int', min: 1, max: 5, default: 3 },
}), async (req, res, next) => {
  try {
    const { title, examDate, courseId, startsAt, weight } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO exams (user_id, course_id, title, exam_date, starts_at, weight) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, courseId ?? null, title, examDate, startsAt || null, weight]
    );
    res.status(201).json({ id: result.insertId, title, examDate, weight });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Course not found' });
    next(err);
  }
});

// POST /api/exams/preview { text } — parse a pasted timetable without saving
router.post('/preview', validate({ text: { type: 'string', required: true, maxLen: 20000 } }), async (req, res, next) => {
  try {
    const { rows, skipped } = parseTimetable(req.body.text);
    // Try to match each parsed course code to a course the student is enrolled in.
    const [courses] = await pool.execute(
      `SELECT c.id, c.code FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = ?`,
      [req.user.id]
    );
    const byCode = Object.fromEntries(courses.map(c => [c.code.toUpperCase(), c.id]));
    res.json({
      rows: rows.map(r => ({ ...r, courseId: r.courseCode ? byCode[r.courseCode.toUpperCase()] || null : null })),
      skipped,
    });
  } catch (err) { next(err); }
});

// POST /api/exams/import { rows: [{ title, date, time, courseId, weight }] }
router.post('/import', validate({ rows: { type: 'array', required: true, maxItems: 60 } }), async (req, res, next) => {
  try {
    let imported = 0;
    for (const row of req.body.rows) {
      if (!row?.title || !row?.date) continue;
      await pool.execute(
        'INSERT INTO exams (user_id, course_id, title, exam_date, starts_at, weight) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, row.courseId || null, String(row.title).slice(0, 160), row.date,
         row.time || null, Math.min(Math.max(Number(row.weight) || 3, 1), 5)]
      );
      imported++;
    }
    res.status(201).json({ message: `Imported ${imported} exam${imported === 1 ? '' : 's'}`, imported });
  } catch (err) { next(err); }
});

// DELETE /api/exams/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM exams WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
