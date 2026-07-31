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

module.exports = router;
