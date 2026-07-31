const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../lib/validate');

const router = express.Router();
router.use(requireAuth);

// GET /api/progress/:courseId — my topic list for a course
router.get('/:courseId', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, topic, status, updated_at
       FROM progress WHERE user_id = ? AND course_id = ?
       ORDER BY topic`,
      [req.user.id, req.params.courseId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/progress { courseId, topic, status } — upsert one topic's status
router.post('/', validate({
  courseId: { type: 'int',    required: true },
  topic:    { type: 'string', required: true, maxLen: 200 },
  status:   { type: 'enum',   required: true, values: ['not_started', 'in_progress', 'completed'] },
}), async (req, res, next) => {
  try {
    const { courseId, topic, status } = req.body;
    await pool.execute(
      `INSERT INTO progress (user_id, course_id, topic, status)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [req.user.id, courseId, topic, status]
    );
    res.status(201).json({ courseId, topic, status });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(404).json({ error: 'Course not found' });
    }
    next(err);
  }
});

// DELETE /api/progress/:id — remove a topic I track
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM progress WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
