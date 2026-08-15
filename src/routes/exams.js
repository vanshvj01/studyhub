// Exams: entered by hand or pasted in from a timetable.
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { parseTimetable } = require('../lib/timetable');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

// GET /api/exams — with how much of the syllabus each one covers
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.title, e.exam_date, e.starts_at, e.weight, e.course_id,
              c.code AS course_code, DATEDIFF(e.exam_date, CURDATE()) AS days_left,
              (SELECT COUNT(*) FROM exam_topics et WHERE et.exam_id = e.id) AS topic_count,
              (SELECT COUNT(*) FROM exam_topics et
                 JOIN syllabus_topics t ON t.id = et.topic_id
                WHERE et.exam_id = e.id AND t.status IN ('revised','mastered')) AS topics_ready,
              (SELECT COUNT(*) FROM syllabus_topics t
                WHERE t.user_id = e.user_id AND t.course_id = e.course_id) AS course_topics
       FROM exams e LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ? AND (c.id IS NULL OR c.archived_at IS NULL)
       ORDER BY e.exam_date`,
      [req.user.id]
    );
    res.json(rows.map(r => ({
      ...r,
      topicCount: Number(r.topic_count),
      topicsReady: Number(r.topics_ready),
      courseTopics: Number(r.course_topics),
      readyPct: Number(r.topic_count) ? Math.round(Number(r.topics_ready) / Number(r.topic_count) * 100) : 0,
    })));
  } catch (err) { next(err); }
});

// GET /api/exams/:id/topics — the syllabus for that course, flagged with what is in scope
router.get('/:id/topics', async (req, res, next) => {
  try {
    const [[exam]] = await pool.execute(
      'SELECT id, title, course_id FROM exams WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (!exam.course_id) return res.json({ exam, units: [], note: 'This exam is not linked to a course, so it has no syllabus.' });

    const [rows] = await pool.execute(
      `SELECT t.id, t.unit, t.title, t.difficulty, t.status, t.order_index,
              EXISTS(SELECT 1 FROM exam_topics et WHERE et.exam_id = ? AND et.topic_id = t.id) AS in_scope
       FROM syllabus_topics t
       WHERE t.user_id = ? AND t.course_id = ?
       ORDER BY t.order_index, t.id`,
      [exam.id, req.user.id, exam.course_id]
    );

    const units = [];
    for (const row of rows) {
      const label = row.unit || 'Ungrouped';
      let unit = units.find(u => u.unit === label);
      if (!unit) { unit = { unit: label, topics: [] }; units.push(unit); }
      unit.topics.push({ ...row, inScope: !!row.in_scope });
    }
    res.json({ exam, units, total: rows.length, inScope: rows.filter(r => r.in_scope).length });
  } catch (err) { next(err); }
});

// PUT /api/exams/:id/topics { topicIds } — set the portion in one go
router.put('/:id/topics', validate({ topicIds: { type: 'array', required: true, maxItems: 400 } }), async (req, res, next) => {
  try {
    const [[exam]] = await pool.execute(
      'SELECT id, course_id FROM exams WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]
    );
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const ids = [...new Set(req.body.topicIds.map(Number).filter(Number.isInteger))];
    await pool.execute('DELETE FROM exam_topics WHERE exam_id = ?', [exam.id]);

    if (ids.length) {
      // Only topics from this student's own syllabus for this course may be added.
      const [valid] = await pool.query(
        'SELECT id FROM syllabus_topics WHERE user_id = ? AND course_id = ? AND id IN (?)',
        [req.user.id, exam.course_id, ids]
      );
      for (const row of valid) {
        await pool.execute('INSERT IGNORE INTO exam_topics (exam_id, topic_id) VALUES (?, ?)', [exam.id, row.id]);
      }
      return res.json({ message: `Portion set: ${valid.length} topic${valid.length === 1 ? '' : 's'}`, count: valid.length });
    }
    res.json({ message: 'Portion cleared — the whole syllabus will be planned', count: 0 });
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
