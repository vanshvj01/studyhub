// Google Classroom import. Pulls courses, coursework and announcements into
// StudyHub's own tables so the planner, notes and deadlines all work off them.
// Read-only: nothing is ever written back to Classroom.
const express = require('express');
const { pool } = require('../config/db');
const Note = require('../models/Note');
const google = require('../lib/google');
const { logger } = require('../lib/logger');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

/** A fresh access token from the stored refresh token. */
async function accessTokenFor(userId) {
  const [[row]] = await pool.execute('SELECT google_refresh_token FROM users WHERE id = ?', [userId]);
  if (!row?.google_refresh_token) {
    throw Object.assign(new Error('Connect Google Classroom first'), { status: 428 });
  }
  const tokens = await google.refreshAccessToken(row.google_refresh_token);
  return tokens.access_token;
}

// GET /api/classroom/status
router.get('/status', async (req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      'SELECT google_id, google_refresh_token, classroom_synced_at FROM users WHERE id = ?',
      [req.user.id]
    );
    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM courses WHERE source = 'classroom') AS courses,
         (SELECT COUNT(*) FROM assignments WHERE user_id = ? AND source = 'classroom') AS assignments`,
      [req.user.id]
    );
    res.json({
      configured: google.isConfigured(),
      connected: Boolean(row?.google_refresh_token),
      googleLinked: Boolean(row?.google_id),
      lastSyncedAt: row?.classroom_synced_at || null,
      imported: { courses: Number(counts.courses), assignments: Number(counts.assignments) },
    });
  } catch (err) { next(err); }
});

// POST /api/classroom/sync — idempotent: re-running updates rather than duplicating
router.post('/sync', async (req, res, next) => {
  try {
    if (!google.isConfigured()) {
      return res.status(503).json({ error: 'Google is not configured on this deployment' });
    }
    const accessToken = await accessTokenFor(req.user.id);
    const courses = await google.listCourses(accessToken);

    const summary = { courses: 0, assignments: 0, notes: 0, skipped: 0 };

    for (const course of courses) {
      const code = google.courseCodeOf(course);
      const title = course.name || code;
      const semester = course.section || new Date().getFullYear().toString();

      // Upsert the course by its Classroom id, so a rename does not duplicate it.
      const [existing] = await pool.execute(
        "SELECT id FROM courses WHERE source = 'classroom' AND source_id = ?", [course.id]
      );
      let courseId = existing[0]?.id;
      if (courseId) {
        await pool.execute('UPDATE courses SET title = ?, semester = ? WHERE id = ?', [title, semester, courseId]);
      } else {
        // Course codes are unique; add a suffix if the student already has one.
        let unique = code;
        for (let n = 2; ; n++) {
          const [clash] = await pool.execute('SELECT 1 FROM courses WHERE code = ?', [unique]);
          if (clash.length === 0) break;
          unique = `${code}-${n}`;
        }
        const [result] = await pool.execute(
          `INSERT INTO courses (code, title, semester, created_by, source, source_id)
           VALUES (?, ?, ?, ?, 'classroom', ?)`,
          [unique, title, semester, req.user.id, course.id]
        );
        courseId = result.insertId;
        summary.courses++;
      }

      await pool.execute(
        'INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)',
        [req.user.id, courseId]
      );

      // ---- coursework becomes deadlines ----
      for (const work of await google.listCoursework(accessToken, course.id)) {
        const due = google.dueDateOf(work);
        if (!due) { summary.skipped++; continue; }   // no due date, nothing to schedule
        const [done] = await pool.execute(
          `INSERT INTO assignments (user_id, course_id, title, due_date, source, source_id)
           VALUES (?, ?, ?, ?, 'classroom', ?)
           ON DUPLICATE KEY UPDATE title = VALUES(title), due_date = VALUES(due_date)`,
          [req.user.id, courseId, (work.title || 'Coursework').slice(0, 200), due, work.id]
        );
        if (done.affectedRows === 1) summary.assignments++;
      }

      // ---- announcements and materials become notes ----
      for (const post of await google.listAnnouncements(accessToken, course.id)) {
        const body = (post.text || '').trim();
        if (!body) continue;
        const sourceKey = `classroom:${post.id}`;
        const already = await Note.findOne({ 'sharedFrom.sourceId': sourceKey }).select('_id').lean();
        if (already) continue;

        const materials = (post.materials || [])
          .map(m => m.driveFile?.driveFile?.title || m.link?.title || m.youtubeVideo?.title)
          .filter(Boolean);

        await Note.create({
          courseId,
          authorId: req.user.id,
          authorName: 'Google Classroom',
          title: body.split('\n')[0].slice(0, 120) || 'Classroom announcement',
          content: materials.length ? `${body}\n\nAttached in Classroom:\n- ${materials.join('\n- ')}` : body,
          tags: ['classroom'],
          sharedFrom: { source: 'classroom', sourceId: sourceKey, url: post.alternateLink || null },
        });
        summary.notes++;
      }
    }

    await pool.execute('UPDATE users SET classroom_synced_at = NOW() WHERE id = ?', [req.user.id]);
    logger.info('classroom sync finished', { user: req.user.id, ...summary });
    res.json({ message: 'Import finished', ...summary });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/classroom/connection — forget the Google link
router.delete('/connection', async (req, res, next) => {
  try {
    await pool.execute('UPDATE users SET google_refresh_token = NULL WHERE id = ?', [req.user.id]);
    res.json({ message: 'Google Classroom disconnected. Imported data stays.' });
  } catch (err) { next(err); }
});

module.exports = router;
