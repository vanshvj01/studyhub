const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const Note = require('../models/Note');
const Deck = require('../models/Deck');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../lib/validate');
const { shortCode } = require('../lib/ids');
const { saveUpload } = require('../config/uploads');

const router = express.Router();
router.use(requireAuth);

const INVITE_TTL_HOURS = 72;

// GET /api/profile — account details plus stats appropriate to the role
router.get('/', async (req, res, next) => {
  try {
    const [[user]] = await pool.execute(
      `SELECT id, name, username, email, role, bio, college, avatar, daily_goal_minutes,
              email_verified, referral_code, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'parent') {
      const [[counts]] = await pool.execute(
        'SELECT COUNT(*) AS children FROM guardian_links WHERE parent_id = ?', [req.user.id]
      );
      return res.json({ ...user, stats: { children: Number(counts.children) } });
    }

    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM enrollments WHERE user_id = ?)                          AS courses,
         (SELECT COUNT(*) FROM progress WHERE user_id = ? AND status = 'completed')    AS topicsDone,
         (SELECT COUNT(*) FROM progress WHERE user_id = ?)                             AS topicsTotal,
         (SELECT COUNT(*) FROM assignments WHERE user_id = ? AND status = 'pending')   AS openAssignments,
         (SELECT COALESCE(SUM(minutes),0) FROM study_sessions WHERE user_id = ?)       AS totalMinutes,
         (SELECT COUNT(*) FROM guardian_links WHERE student_id = ?)                    AS guardians,
         (SELECT COUNT(*) FROM users WHERE referred_by = ?)                            AS referrals`,
      Array(7).fill(req.user.id)
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
        guardians: Number(counts.guardians),
        referrals: Number(counts.referrals),
        notesShared,
        decksBuilt,
      },
    });
  } catch (err) { next(err); }
});

// PUT /api/profile { name, bio, college, avatar, dailyGoalMinutes }
router.put('/', validate({
  name: { type: 'string', required: true, maxLen: 100 },
  bio: { type: 'string', maxLen: 300 },
  college: { type: 'string', maxLen: 120 },
  dailyGoalMinutes: { type: 'int', min: 10, max: 600, default: 60 },
}), async (req, res, next) => {
  try {
    const { name, bio, college, dailyGoalMinutes } = req.body;

    // Avatars are stored like any other upload and referenced by URL. Keeping the
    // base64 in the users table would mean every list endpoint that returns a
    // person — leaderboard, chat contacts, referrals — ships megabytes of image
    // data inline.
    let avatar = null;
    if (req.body.avatar) {
      if (String(req.body.avatar).startsWith('data:')) {
        try {
          const saved = await saveUpload({ name: `avatar-${req.user.id}.jpg`, dataUrl: req.body.avatar }, req.user.id);
          avatar = saved.url;
        } catch (e) {
          return res.status(e.status || 400).json({ error: e.message });
        }
      } else {
        avatar = req.body.avatar; // already a URL, left untouched
      }
    }
    await pool.execute(
      `UPDATE users SET name = ?, bio = ?, college = ?, avatar = COALESCE(?, avatar),
              daily_goal_minutes = ?
       WHERE id = ?`,
      [name, bio || null, college || null, avatar || null, dailyGoalMinutes, req.user.id]
    );
    // keep the denormalized author name on shared content in sync
    await Promise.all([
      Note.updateMany({ authorId: req.user.id }, { authorName: name }),
      Deck.updateMany({ ownerId: req.user.id }, { ownerName: name }),
    ]);
    res.json({ message: 'Profile updated' });
  } catch (err) { next(err); }
});

// PUT /api/profile/password { currentPassword, newPassword }
router.put('/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const { validatePassword } = require('../lib/accounts');
    if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
    const checked = validatePassword(newPassword);
    if (!checked.ok) return res.status(400).json({ error: checked.error });

    const [[user]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
      await bcrypt.hash(checked.value, 10), req.user.id,
    ]);
    res.json({ message: 'Password changed' });
  } catch (err) { next(err); }
});

// ------------------------------------------------- guardian invites (students)

// GET /api/profile/guardians — who can see my progress, plus live invite codes
router.get('/guardians', requireRole('student'), async (req, res, next) => {
  try {
    const [linked] = await pool.execute(
      `SELECT u.id, u.name, u.email, g.created_at
       FROM guardian_links g JOIN users u ON u.id = g.parent_id
       WHERE g.student_id = ? ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    const [invites] = await pool.execute(
      `SELECT code, expires_at, used_by FROM student_invites
       WHERE student_id = ? AND used_by IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ guardians: linked, invites });
  } catch (err) { next(err); }
});

// POST /api/profile/guardians/invite — issue a fresh code
router.post('/guardians/invite', requireRole('student'), async (req, res, next) => {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = shortCode(8);
      try {
        await pool.execute(
          `INSERT INTO student_invites (code, student_id, expires_at)
           VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
          [code, req.user.id, INVITE_TTL_HOURS]
        );
        return res.status(201).json({ code, expiresInHours: INVITE_TTL_HOURS });
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    res.status(500).json({ error: 'Could not allocate an invite code' });
  } catch (err) { next(err); }
});

// DELETE /api/profile/guardians/:parentId — revoke a parent's access
router.delete('/guardians/:parentId', requireRole('student'), async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM guardian_links WHERE student_id = ? AND parent_id = ?',
      [req.user.id, req.params.parentId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No such link' });
    res.json({ message: 'Access revoked' });
  } catch (err) { next(err); }
});

module.exports = router;
