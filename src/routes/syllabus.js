// The syllabus: every topic a student has to learn, grouped into units.
// This is what the planner schedules, and what an exam's "portion" points at.
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { parseSyllabus } = require('../lib/syllabus');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

const STATUSES = ['not_started', 'learning', 'revised', 'mastered'];

// GET /api/syllabus?courseId= — topics grouped by unit, with a coverage summary
router.get('/', async (req, res, next) => {
  try {
    const where = ['t.user_id = ?'];
    const params = [req.user.id];
    if (req.query.courseId) { where.push('t.course_id = ?'); params.push(req.query.courseId); }

    const [rows] = await pool.execute(
      `SELECT t.id, t.course_id, t.unit, t.title, t.order_index, t.difficulty, t.status, t.notes,
              c.code AS course_code
       FROM syllabus_topics t JOIN courses c ON c.id = t.course_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.code, t.order_index, t.id`,
      params
    );

    const units = [];
    for (const row of rows) {
      const label = row.unit || 'Ungrouped';
      let unit = units.find(u => u.unit === label && u.courseId === row.course_id);
      if (!unit) {
        unit = { unit: label, courseId: row.course_id, courseCode: row.course_code, topics: [] };
        units.push(unit);
      }
      unit.topics.push(row);
    }

    const done = rows.filter(r => r.status === 'mastered' || r.status === 'revised').length;
    res.json({
      units,
      topics: rows,
      summary: {
        total: rows.length,
        covered: done,
        coveragePct: rows.length ? Math.round(done / rows.length * 100) : 0,
        byStatus: Object.fromEntries(STATUSES.map(s => [s, rows.filter(r => r.status === s).length])),
      },
    });
  } catch (err) { next(err); }
});

// POST /api/syllabus { courseId, title, unit?, difficulty? }
router.post('/', validate({
  courseId: { type: 'int', required: true },
  title: { type: 'string', required: true, maxLen: 200 },
  unit: { type: 'string', maxLen: 120 },
  difficulty: { type: 'int', min: 1, max: 5, default: 3 },
}), async (req, res, next) => {
  try {
    const { courseId, title, unit, difficulty } = req.body;
    const [[last]] = await pool.execute(
      'SELECT COALESCE(MAX(order_index), -1) AS n FROM syllabus_topics WHERE user_id = ? AND course_id = ?',
      [req.user.id, courseId]
    );
    const [result] = await pool.execute(
      `INSERT INTO syllabus_topics (user_id, course_id, unit, title, order_index, difficulty)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, courseId, unit || null, title, Number(last.n) + 1, difficulty]
    );
    res.status(201).json({ id: result.insertId, title, unit: unit || null, difficulty, status: 'not_started' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That topic is already in this syllabus' });
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Course not found' });
    next(err);
  }
});

// POST /api/syllabus/preview { text } — parse without saving
router.post('/preview', validate({ text: { type: 'string', required: true, maxLen: 40000 } }), (req, res) => {
  const { topics, units, skipped } = parseSyllabus(req.body.text);
  res.json({ topics, units, skipped, count: topics.length });
});

// POST /api/syllabus/import { courseId, topics[] }
router.post('/import', validate({
  courseId: { type: 'int', required: true },
  topics: { type: 'array', required: true, maxItems: 300 },
}), async (req, res, next) => {
  try {
    const { courseId, topics } = req.body;
    const [[last]] = await pool.execute(
      'SELECT COALESCE(MAX(order_index), -1) AS n FROM syllabus_topics WHERE user_id = ? AND course_id = ?',
      [req.user.id, courseId]
    );
    let order = Number(last.n) + 1;
    let imported = 0, duplicates = 0;

    for (const topic of topics) {
      if (!topic?.title) continue;
      try {
        await pool.execute(
          `INSERT INTO syllabus_topics (user_id, course_id, unit, title, order_index, difficulty)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [req.user.id, courseId, topic.unit || null, String(topic.title).slice(0, 200), order++,
           Math.min(Math.max(Number(topic.difficulty) || 3, 1), 5)]
        );
        imported++;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') duplicates++;   // already in the syllabus, fine
        else throw e;
      }
    }
    res.status(201).json({ message: `Added ${imported} topic${imported === 1 ? '' : 's'}`, imported, duplicates });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Course not found' });
    next(err);
  }
});

// PATCH /api/syllabus/:id { status?, difficulty?, title?, unit? }
router.patch('/:id', validate({
  status: { type: 'enum', values: STATUSES },
  difficulty: { type: 'int', min: 1, max: 5 },
  title: { type: 'string', maxLen: 200 },
  unit: { type: 'string', maxLen: 120 },
}), async (req, res, next) => {
  try {
    const fields = [];
    const values = [];
    for (const key of ['status', 'difficulty', 'title', 'unit']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = ?`); values.push(req.body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const [result] = await pool.execute(
      `UPDATE syllabus_topics SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      [...values, req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Topic not found' });
    res.json({ id: Number(req.params.id), ...req.body });
  } catch (err) { next(err); }
});

// DELETE /api/syllabus/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM syllabus_topics WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Topic not found' });
    res.json({ message: 'Removed' });
  } catch (err) { next(err); }
});

module.exports = router;
