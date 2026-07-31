// Marks tracker: individual assessments in, weighted percentages out.
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { letterFor, weightedAverage, percentOf, overallAverage } = require('../lib/marks');

const router = express.Router();
router.use(requireAuth);

// GET /api/grades — every mark, grouped per course with a weighted average
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT g.id, g.course_id, g.title, g.score, g.max_score, g.weight, g.recorded_on,
              c.code AS course_code, c.title AS course_title
       FROM grades g JOIN courses c ON c.id = g.course_id
       WHERE g.user_id = ?
       ORDER BY c.code, g.recorded_on DESC`,
      [req.user.id]
    );

    const byCourse = new Map();
    for (const r of rows) {
      const item = {
        id: r.id,
        title: r.title,
        score: Number(r.score),
        maxScore: Number(r.max_score),
        weight: Number(r.weight),
        recordedOn: r.recorded_on,
        pct: percentOf(r.score, r.max_score),
      };
      if (!byCourse.has(r.course_id)) {
        byCourse.set(r.course_id, {
          courseId: r.course_id, code: r.course_code, title: r.course_title, items: [],
        });
      }
      byCourse.get(r.course_id).items.push(item);
    }

    const courses = [...byCourse.values()].map(c => {
      const average = weightedAverage(c.items);
      return { ...c, average, grade: letterFor(average) };
    });
    const overall = overallAverage(courses);

    res.json({ courses, overall, overallGrade: letterFor(overall) });
  } catch (err) { next(err); }
});

// POST /api/grades { courseId, title, score, maxScore, weight, recordedOn }
router.post('/', validate({
  courseId:   { type: 'int',    required: true },
  title:      { type: 'string', required: true, maxLen: 160 },
  score:      { type: 'number', required: true, min: 0 },
  maxScore:   { type: 'number', required: true, min: 0.01 },
  weight:     { type: 'number', min: 0.1, max: 100, default: 1 },
  recordedOn: { type: 'date' },
}), async (req, res, next) => {
  try {
    const { courseId, title, score, maxScore, weight, recordedOn } = req.body;
    const [result] = await pool.execute(
      `INSERT INTO grades (user_id, course_id, title, score, max_score, weight, recorded_on)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, courseId, title, score, maxScore, weight,
       recordedOn || new Date().toISOString().slice(0, 10)]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Course not found' });
    next(err);
  }
});

// DELETE /api/grades/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM grades WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
