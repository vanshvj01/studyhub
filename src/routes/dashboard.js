// Cross-store rollup: progress + deadlines from MySQL, notes + decks from MongoDB.
const express = require('express');
const { pool } = require('../config/db');
const Note = require('../models/Note');
const Deck = require('../models/Deck');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard
router.get('/', async (req, res, next) => {
  try {
    const [courses] = await pool.execute(
      `SELECT c.id, c.code, c.title, c.semester,
              COUNT(p.id) AS total_topics,
              SUM(p.status = 'completed') AS completed_topics,
              (SELECT COUNT(*) FROM assignments a
                 WHERE a.course_id = c.id AND a.user_id = e.user_id AND a.status = 'pending') AS open_assignments
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN progress p ON p.course_id = c.id AND p.user_id = e.user_id
       WHERE e.user_id = ?
       GROUP BY c.id, c.code, c.title, c.semester, e.user_id
       ORDER BY c.code`,
      [req.user.id]
    );

    const ids = courses.map(c => c.id);
    const [noteCounts, deckCounts] = await Promise.all([
      ids.length ? Note.aggregate([{ $match: { courseId: { $in: ids } } }, { $group: { _id: '$courseId', count: { $sum: 1 } } }]) : [],
      ids.length ? Deck.aggregate([{ $match: { courseId: { $in: ids } } }, { $group: { _id: '$courseId', count: { $sum: 1 } } }]) : [],
    ]);
    const noteMap = Object.fromEntries(noteCounts.map(n => [n._id, n.count]));
    const deckMap = Object.fromEntries(deckCounts.map(d => [d._id, d.count]));

    res.json(
      courses.map(c => {
        const total = Number(c.total_topics) || 0;
        const done = Number(c.completed_topics) || 0;
        return {
          id: c.id,
          code: c.code,
          title: c.title,
          semester: c.semester,
          totalTopics: total,
          completedTopics: done,
          progressPct: total ? Math.round((done / total) * 100) : 0,
          openAssignments: Number(c.open_assignments) || 0,
          sharedNotes: noteMap[c.id] || 0,
          decks: deckMap[c.id] || 0,
        };
      })
    );
  } catch (err) { next(err); }
});

module.exports = router;
