const express = require('express');
const Note = require('../models/Note');
const { pool } = require('../config/db');
const { saveUpload } = require('../config/uploads');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const shape = n => ({ ...n, upvoteCount: n.upvotes.length, upvotes: undefined });

// GET /api/notes?courseId=&tag=&search= — browse/search shared notes
router.get('/', async (req, res, next) => {
  try {
    const { courseId, tag, search } = req.query;
    const filter = { archivedAt: null };   // archived imports stay hidden
    if (courseId) filter.courseId = Number(courseId);
    if (tag) filter.tags = tag.toLowerCase();
    if (search) filter.$text = { $search: search };
    const notes = await Note.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json(notes.map(shape));
  } catch (err) { next(err); }
});

// POST /api/notes { courseId, title, content, tags[], attachments[{name,dataUrl}] }
router.post('/', async (req, res, next) => {
  try {
    const { courseId, title, content, tags, attachments } = req.body || {};
    if (!courseId || !title || !content) {
      return res.status(400).json({ error: 'courseId, title, content are required' });
    }
    // cross-store integrity: course must exist in MySQL
    const [rows] = await pool.execute('SELECT id FROM courses WHERE id = ?', [courseId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Course not found' });

    let saved = [];
    try {
      saved = await Promise.all(
        (attachments || []).slice(0, 5).map(file => saveUpload(file, req.user.id))
      );
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }

    const [[me]] = await pool.execute('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const note = await Note.create({
      courseId: Number(courseId),
      authorId: req.user.id,
      authorName: me?.name || 'Unknown',
      title,
      content,
      tags: (tags || []).map(t => String(t).toLowerCase().trim()).filter(Boolean),
      attachments: saved,
    });
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// GET /api/notes/:id
router.get('/:id', async (req, res, next) => {
  try {
    const note = await Note.findById(req.params.id).lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json(shape(note));
  } catch (err) { next(err); }
});

// POST /api/notes/:id/upvote — toggle my upvote
router.post('/:id/upvote', async (req, res, next) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const i = note.upvotes.indexOf(req.user.id);
    if (i >= 0) note.upvotes.splice(i, 1);
    else note.upvotes.push(req.user.id);
    await note.save();
    res.json({ upvoteCount: note.upvotes.length, upvoted: i < 0 });
  } catch (err) { next(err); }
});

// DELETE /api/notes/:id — author only
router.delete('/:id', async (req, res, next) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.authorId !== req.user.id) {
      return res.status(403).json({ error: 'Only the author can delete this note' });
    }
    await note.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
