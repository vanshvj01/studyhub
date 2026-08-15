const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../lib/validate');

const router = express.Router();
router.use(requireAuth);

// GET /api/courses — all courses, flagged with whether I'm enrolled
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id, c.code, c.title, c.semester, u.name AS created_by,
              EXISTS(SELECT 1 FROM enrollments e
                     WHERE e.course_id = c.id AND e.user_id = ?) AS enrolled
       FROM courses c JOIN users u ON u.id = c.created_by
       WHERE c.archived_at IS NULL
       ORDER BY c.code`,
      [req.user.id]
    );
    res.json(rows.map(r => ({ ...r, enrolled: !!r.enrolled })));
  } catch (err) { next(err); }
});

// POST /api/courses { code, title, semester }
router.post('/', validate({
  code:     { type: 'string', required: true, maxLen: 20 },
  title:    { type: 'string', required: true, maxLen: 200 },
  semester: { type: 'string', required: true, maxLen: 20 },
}), async (req, res, next) => {
  try {
    const { code, title, semester } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO courses (code, title, semester, created_by) VALUES (?, ?, ?, ?)',
      [code.toUpperCase(), title, semester, req.user.id]
    );
    // creator auto-enrolls
    await pool.execute(
      'INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)',
      [req.user.id, result.insertId]
    );
    res.status(201).json({ id: result.insertId, code: code.toUpperCase(), title, semester });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Course code already exists' });
    }
    next(err);
  }
});

// POST /api/courses/:id/enroll
router.post('/:id/enroll', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)',
      [req.user.id, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(200).json({ message: 'Already enrolled' });
    }
    res.status(201).json({ message: 'Enrolled' });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(404).json({ error: 'Course not found' });
    }
    next(err);
  }
});

// PATCH /api/courses/:id { title?, code?, semester? }
// The person who created the course can rename it. Classroom-imported courses
// keep their source id, so a rename survives the next automatic import.
router.patch('/:id', validate({
  title: { type: 'string', maxLen: 200 },
  code: { type: 'string', maxLen: 20 },
  semester: { type: 'string', maxLen: 20 },
}), async (req, res, next) => {
  try {
    const [[course]] = await pool.execute(
      'SELECT id, created_by, source FROM courses WHERE id = ? AND archived_at IS NULL',
      [req.params.id]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (course.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only whoever added this course can rename it' });
    }

    const fields = [];
    const values = [];
    if (req.body.title !== undefined)    { fields.push('title = ?');    values.push(req.body.title); }
    if (req.body.code !== undefined)     { fields.push('code = ?');     values.push(req.body.code.toUpperCase()); }
    if (req.body.semester !== undefined) { fields.push('semester = ?'); values.push(req.body.semester); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    await pool.execute(`UPDATE courses SET ${fields.join(', ')} WHERE id = ?`, [...values, course.id]);
    res.json({ id: course.id, ...req.body, renamedImport: course.source === 'classroom' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That course code is already taken' });
    next(err);
  }
});

module.exports = router;
