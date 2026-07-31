const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const Note = require('../models/Note');
const Deck = require('../models/Deck');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/profile — profile fields + aggregate stats across both stores
router.get('/', async (req, res, next) => {
  try {
    const [[user]] = await pool.execute(
      `SELECT id, name, email, bio, college, avatar, daily_goal_minutes, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM enrollments WHERE user_id = ?)                          AS courses,
         (SELECT COUNT(*) FROM progress WHERE user_id = ? AND status = 'completed')    AS topicsDone,
         (SELECT COUNT(*) FROM progress WHERE user_id = ?)                             AS topicsTotal,
         (SELECT COUNT(*) FROM assignments WHERE user_id = ? AND status = 'pending')   AS openAssignments,
         (SELECT COALESCE(SUM(minutes),0) FROM study_sessions WHERE user_id = ?)       AS totalMinutes`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );

    const [notesShared, decksBuilt] = await Promise.all([
      Note.countDocuments({ authorId: req.user.id }),
      Deck.countDocuments({ ownerId: req.user.id }),
    ]);

    res.json({
      ...user,
      stats: {
        courses: Number(counts.courses),
        topicsDone: Number(counts.topicsDone),
        topicsTotal: Number(counts.topicsTotal),
        openAssignments: Number(counts.openAssignments),
        totalMinutes: Number(counts.totalMinutes),
        notesShared,
        decksBuilt,
      },
    });
  } catch (err) { next(err); }
});

// PUT /api/profile { name, bio, college, avatar, dailyGoalMinutes }
router.put('/', async (req, res, next) => {
  try {
    const { name, bio, college, avatar, dailyGoalMinutes } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (avatar && avatar.length > 4_000_000) {
      return res.status(413).json({ error: 'Avatar image is too large (max ~3 MB)' });
    }
    await pool.execute(
      `UPDATE users SET name = ?, bio = ?, college = ?, avatar = COALESCE(?, avatar),
              daily_goal_minutes = ?
       WHERE id = ?`,
      [
        name.trim(),
        bio?.trim() || null,
        college?.trim() || null,
        avatar || null,
        Math.min(Math.max(Number(dailyGoalMinutes) || 60, 10), 600),
        req.user.id,
      ]
    );
    // keep the denormalized author name on shared content in sync
    await Promise.all([
      Note.updateMany({ authorId: req.user.id }, { authorName: name.trim() }),
      Deck.updateMany({ ownerId: req.user.id }, { ownerName: name.trim() }),
    ]);
    res.json({ message: 'Profile updated' });
  } catch (err) { next(err); }
});

// PUT /api/profile/password { currentPassword, newPassword }
router.put('/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const [[user]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
      await bcrypt.hash(newPassword, 10),
      req.user.id,
    ]);
    res.json({ message: 'Password changed' });
  } catch (err) { next(err); }
});

module.exports = router;
