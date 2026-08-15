const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../lib/validate');

const router = express.Router();
router.use(requireAuth);

// GET /api/assignments?courseId=&scope=upcoming|all
router.get('/', async (req, res, next) => {
  try {
    const { courseId, scope } = req.query;
    const where = ['a.user_id = ?', 'a.archived_at IS NULL'];
    const params = [req.user.id];
    if (courseId) { where.push('a.course_id = ?'); params.push(courseId); }
    if (scope === 'upcoming') where.push("a.status = 'pending'");

    const [rows] = await pool.execute(
      `SELECT a.id, a.title, a.due_date, a.status, a.course_id,
              c.code AS course_code, c.title AS course_title,
              DATEDIFF(a.due_date, CURDATE()) AS days_left
       FROM assignments a JOIN courses c ON c.id = a.course_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.status ASC, a.due_date ASC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/assignments { courseId, title, dueDate }
router.post('/', validate({
  courseId: { type: 'int',    required: true },
  title:    { type: 'string', required: true, maxLen: 200 },
  dueDate:  { type: 'date',   required: true },
}), async (req, res, next) => {
  try {
    const { courseId, title, dueDate } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO assignments (user_id, course_id, title, due_date) VALUES (?, ?, ?, ?)',
      [req.user.id, courseId, title, dueDate]
    );
    res.status(201).json({ id: result.insertId, title, dueDate, status: 'pending' });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Course not found' });
    next(err);
  }
});

// PATCH /api/assignments/:id — toggle done/pending
router.patch('/:id', async (req, res, next) => {
  try {
    const status = req.body?.status === 'done' ? 'done' : 'pending';
    const [result] = await pool.execute(
      'UPDATE assignments SET status = ? WHERE id = ? AND user_id = ?',
      [status, req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ id: Number(req.params.id), status });
  } catch (err) { next(err); }
});

// DELETE /api/assignments/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM assignments WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
