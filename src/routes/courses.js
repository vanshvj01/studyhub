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
       WHERE c.archived_at IS NULL
       ORDER BY c.code`,
      [req.user.id]
    );
    res.json(rows.map(r => ({ ...r, enrolled: !!r.enrolled })));
  } catch (err) { next(err); }
});

// GET /api/courses/:id — one course, with what this user is allowed to do to it.
// The detail page used to be handed its code and title through the click that
// opened it, which meant a course reached from a notification or a shared note
// arrived with no title at all — and the rename box then opened blank. The page
// asks the server now, so every route into it shows the same thing.
router.get('/:id', async (req, res, next) => {
  try {
    const [[course]] = await pool.execute(
      `SELECT c.id, c.code, c.title, c.semester, c.source, c.created_by,
              u.name AS created_by_name,
              EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ?) AS enrolled,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS student_count
       FROM courses c JOIN users u ON u.id = c.created_by
       WHERE c.id = ? AND c.archived_at IS NULL`,
      [req.user.id, req.params.id]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const mine = course.created_by === req.user.id;
    res.json({
      id: course.id,
      code: course.code,
      title: course.title,
      semester: course.semester,
      source: course.source,
      createdBy: course.created_by_name,
      isCreator: mine,
      enrolled: !!course.enrolled,
      studentCount: Number(course.student_count),
      // The UI uses these to decide which buttons to show, so a student never
      // clicks something that was only ever going to return 403.
      canRename: mine,
      canDeleteForEveryone: mine,
    });
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

// PATCH /api/courses/:id { title?, code?, semester? }
// The person who created the course can rename it. Classroom-imported courses
// keep their source id, so a rename survives the next automatic import.
router.patch('/:id', validate({
  title: { type: 'string', maxLen: 200 },
  code: { type: 'string', maxLen: 20 },
  semester: { type: 'string', maxLen: 20 },
}), async (req, res, next) => {
  try {
    const [[course]] = await pool.execute(
      'SELECT id, created_by, source FROM courses WHERE id = ? AND archived_at IS NULL',
      [req.params.id]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (course.created_by !== req.user.id) {
      // Naming the person makes this actionable: the student can go and ask
      // them, instead of assuming the button is broken.
      const [[owner]] = await pool.execute('SELECT name FROM users WHERE id = ?', [course.created_by]);
      return res.status(403).json({
        error: `${owner?.name || 'Whoever added this course'} added this course, so only they can rename it. You can still remove it from your own courses.`,
      });
    }

    const fields = [];
    const values = [];
    if (req.body.title !== undefined)    { fields.push('title = ?');    values.push(req.body.title); }
    if (req.body.code !== undefined)     { fields.push('code = ?');     values.push(req.body.code.toUpperCase()); }
    if (req.body.semester !== undefined) { fields.push('semester = ?'); values.push(req.body.semester); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    await pool.execute(`UPDATE courses SET ${fields.join(', ')} WHERE id = ?`, [...values, course.id]);
    res.json({ id: course.id, ...req.body, renamedImport: course.source === 'classroom' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That course code is already taken' });
    next(err);
  }
});

// DELETE /api/courses/:id?scope=mine|everyone
//
// Two very different operations behind one button:
//
//   scope=mine     unenrols you and clears the work you did on this course.
//                  Everyone else keeps theirs. This is what most people mean.
//   scope=everyone removes the course itself. Only the person who added it may
//                  do this, and they have to type the course code back to
//                  confirm — there is no undo and other students lose their work
//                  too.
router.delete('/:id', async (req, res, next) => {
  try {
    const [[course]] = await pool.execute(
      'SELECT id, code, title, created_by FROM courses WHERE id = ? AND archived_at IS NULL',
      [req.params.id]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const scope = req.query.scope === 'everyone' ? 'everyone' : 'mine';

    if (scope === 'everyone') {
      if (course.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Only whoever added this course can delete it for everyone' });
      }
      // Typing the code back is the last chance to notice you are on the wrong
      // course. Compared case-insensitively so it is a check, not a typing test.
      const typed = String(req.query.confirm || '').trim().toUpperCase();
      if (typed !== course.code.toUpperCase()) {
        return res.status(400).json({ error: `Type ${course.code} to confirm`, needsConfirmation: true, code: course.code });
      }

      const [[{ n: others }]] = await pool.execute(
        'SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ? AND user_id <> ?',
        [course.id, req.user.id]
      );

      await removeCourseContent({ courseId: course.id });
      // enrollments, syllabus_topics, assignments, grades and progress cascade
      // from this row; exams and study_sessions keep their history with a null
      // course, which is why a deleted course never wipes a study streak.
      await pool.execute('DELETE FROM courses WHERE id = ?', [course.id]);

      return res.json({
        message: `Deleted "${course.title}"`,
        scope: 'everyone',
        affectedOthers: Number(others),
      });
    }

    await removeCourseContent({ courseId: course.id, userId: req.user.id });
    await pool.execute('DELETE FROM syllabus_topics WHERE user_id = ? AND course_id = ?', [req.user.id, course.id]);
    await pool.execute('DELETE FROM assignments     WHERE user_id = ? AND course_id = ?', [req.user.id, course.id]);
    await pool.execute('DELETE FROM exams           WHERE user_id = ? AND course_id = ?', [req.user.id, course.id]);
    await pool.execute('DELETE FROM grades          WHERE user_id = ? AND course_id = ?', [req.user.id, course.id]);
    await pool.execute('DELETE FROM enrollments     WHERE user_id = ? AND course_id = ?', [req.user.id, course.id]);
    // Study sessions are deliberately kept: those hours were really studied, and
    // the streak should not break because a course was tidied away.
    await pool.execute('UPDATE study_sessions SET course_id = NULL WHERE user_id = ? AND course_id = ?', [req.user.id, course.id]);

    res.json({ message: `Removed "${course.title}" from your courses`, scope: 'mine' });
  } catch (err) { next(err); }
});

/**
 * Notes, decks and rooms live in MongoDB, so no foreign key cleans them up.
 * Omit userId to remove every student's content for the course.
 */
async function removeCourseContent({ courseId, userId }) {
  const Note = require('../models/Note');
  const Deck = require('../models/Deck');
  const Room = require('../models/Room');

  const scope = { courseId };

  await Promise.all([
    // Only your own notes and decks go when you remove a course from your list —
    // a note you shared with the class is not yours to delete on your way out.
    Note.deleteMany(userId ? { courseId, authorId: userId } : scope),
    Deck.deleteMany(userId ? { courseId, ownerId: userId } : scope),
    // A shared study room belongs to the course, not to one student, so it only
    // goes when the course itself does.
    userId ? Promise.resolve() : Room.deleteMany(scope),
  ]);
}

module.exports = router;
