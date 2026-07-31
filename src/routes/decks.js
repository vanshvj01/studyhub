// Flashcard decks + Leitner-box quiz review.
const express = require('express');
const Deck = require('../models/Deck');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const summarize = d => ({
  _id: d._id,
  courseId: d.courseId,
  title: d.title,
  description: d.description,
  ownerId: d.ownerId,
  ownerName: d.ownerName,
  cardCount: d.cards.length,
  mastered: d.cards.filter(c => c.box >= 4).length,
  updatedAt: d.updatedAt,
});

// GET /api/decks?courseId= — decks shared for a course
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.courseId) filter.courseId = Number(req.query.courseId);
    const decks = await Deck.find(filter).sort({ updatedAt: -1 }).limit(100);
    res.json(decks.map(summarize));
  } catch (err) { next(err); }
});

// GET /api/decks/:id — full deck with cards
router.get('/:id', async (req, res, next) => {
  try {
    const deck = await Deck.findById(req.params.id).lean();
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    res.json(deck);
  } catch (err) { next(err); }
});

// POST /api/decks { courseId, title, description, cards[] }
router.post('/', async (req, res, next) => {
  try {
    const { courseId, title, description, cards } = req.body || {};
    if (!courseId || !title) return res.status(400).json({ error: 'courseId and title are required' });
    const [rows] = await pool.execute('SELECT id FROM courses WHERE id = ?', [courseId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Course not found' });

    const [[me]] = await pool.execute('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const deck = await Deck.create({
      courseId: Number(courseId),
      ownerId: req.user.id,
      ownerName: me?.name || 'Unknown',
      title: title.trim(),
      description: (description || '').trim(),
      cards: (cards || [])
        .filter(c => c && c.front && c.back)
        .map(c => ({ front: String(c.front).trim(), back: String(c.back).trim() })),
    });
    res.status(201).json(summarize(deck));
  } catch (err) { next(err); }
});

// POST /api/decks/:id/cards { front, back } — owner adds a card
router.post('/:id/cards', async (req, res, next) => {
  try {
    const { front, back } = req.body || {};
    if (!front || !back) return res.status(400).json({ error: 'front and back are required' });
    const deck = await Deck.findById(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    if (deck.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit this deck' });
    deck.cards.push({ front: String(front).trim(), back: String(back).trim() });
    await deck.save();
    res.status(201).json(summarize(deck));
  } catch (err) { next(err); }
});

// POST /api/decks/:id/review { cardId, correct } — move the card up/down a box
router.post('/:id/review', async (req, res, next) => {
  try {
    const { cardId, correct } = req.body || {};
    const deck = await Deck.findById(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    const card = deck.cards.id(cardId);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    card.box = correct ? Math.min(card.box + 1, 5) : 1;
    card.lastReviewed = new Date();
    await deck.save();
    res.json({ cardId, box: card.box });
  } catch (err) { next(err); }
});

// DELETE /api/decks/:id/cards/:cardId
router.delete('/:id/cards/:cardId', async (req, res, next) => {
  try {
    const deck = await Deck.findById(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    if (deck.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit this deck' });
    const card = deck.cards.id(req.params.cardId);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    card.deleteOne();
    await deck.save();
    res.json({ message: 'Card removed' });
  } catch (err) { next(err); }
});

// DELETE /api/decks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deck = await Deck.findById(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    if (deck.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete this deck' });
    await deck.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
