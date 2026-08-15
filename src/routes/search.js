// One search box across both stores: courses from MySQL, notes and decks from MongoDB.
const express = require('express');
const { pool } = require('../config/db');
const Note = require('../models/Note');
const Deck = require('../models/Deck');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/search?q=
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ courses: [], notes: [], decks: [] });
    const rx = new RegExp(escapeRegex(q), 'i');

    const [courses] = await pool.execute(
      `SELECT id, code, title, semester FROM courses
       WHERE archived_at IS NULL AND (code LIKE ? OR title LIKE ?) ORDER BY code LIMIT 10`,
      [`%${q}%`, `%${q}%`]
    );
    const [notes, decks] = await Promise.all([
      Note.find({ archivedAt: null, $or: [{ title: rx }, { content: rx }, { tags: rx }] })
        .select('title authorName courseId createdAt').sort({ createdAt: -1 }).limit(10).lean(),
      Deck.find({ $or: [{ title: rx }, { description: rx }] })
        .select('title ownerName courseId cards').limit(10).lean(),
    ]);

    res.json({
      courses,
      notes,
      decks: decks.map(d => ({ _id: d._id, title: d.title, ownerName: d.ownerName, courseId: d.courseId, cardCount: d.cards.length })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
