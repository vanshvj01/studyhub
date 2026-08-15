// The Classroom import itself, separated from the HTTP route so the background
// scheduler and the manual "Import now" button run exactly the same code.
const { pool } = require('../config/db');
const Note = require('../models/Note');
const google = require('./google');
const { logger } = require('./logger');

const CLASSROOM_SCOPE = 'https://www.googleapis.com/auth/classroom.courses.readonly';
const hasClassroomScope = scopes => String(scopes || '').includes(CLASSROOM_SCOPE);

/** Decides whether a user is due for a background sync. Pure, so it is testable. */
function dueForSync(user, { now = new Date(), intervalMinutes = 30 } = {}) {
  if (!user?.google_refresh_token) return false;
  if (!hasClassroomScope(user.google_scopes)) return false;
  if (user.classroom_auto_sync === 0 || user.classroom_auto_sync === false) return false;
  if (!user.classroom_synced_at) return true;               // never synced
  const elapsedMinutes = (now - new Date(user.classroom_synced_at)) / 60000;
  return elapsedMinutes >= intervalMinutes;
}

async function accessTokenFor(userId) {
  const [[row]] = await pool.execute(
    'SELECT google_refresh_token, google_scopes FROM users WHERE id = ?', [userId]
  );
  if (!row?.google_refresh_token) {
    throw Object.assign(new Error('Connect Google Classroom first'), { status: 428 });
  }
  if (!hasClassroomScope(row.google_scopes)) {
    throw Object.assign(
      new Error('Your Google account is signed in, but Classroom access has not been granted yet. Use Grant Classroom access.'),
      { status: 428 }
    );
  }
  const tokens = await google.refreshAccessToken(row.google_refresh_token);
  return tokens.access_token;
}

/**
 * Pulls courses, coursework and announcements for one user.
 * Idempotent: re-running updates existing rows instead of duplicating them.
 */
async function syncUserClassroom(userId) {
  const accessToken = await accessTokenFor(userId);
  const courses = await google.listCourses(accessToken);
  const summary = { courses: 0, assignments: 0, notes: 0, skipped: 0, newDeadlines: [] };

  for (const course of courses) {
    const code = google.courseCodeOf(course);
    const title = course.name || code;
    const semester = course.section || new Date().getFullYear().toString();

    const [existing] = await pool.execute(
      "SELECT id FROM courses WHERE source = 'classroom' AND source_id = ?", [course.id]
    );
    let courseId = existing[0]?.id;
    if (courseId) {
      // Only fill in blanks — a title the student edited here is theirs to keep.
      await pool.execute(
        'UPDATE courses SET semester = COALESCE(NULLIF(semester, \'\'), ?) WHERE id = ?',
        [semester, courseId]
      );
    } else {
      let unique = code;
      for (let n = 2; ; n++) {
        const [clash] = await pool.execute('SELECT 1 FROM courses WHERE code = ?', [unique]);
        if (clash.length === 0) break;
        unique = `${code}-${n}`;
      }
      const [result] = await pool.execute(
        `INSERT INTO courses (code, title, semester, created_by, source, source_id)
         VALUES (?, ?, ?, ?, 'classroom', ?)`,
        [unique, title, semester, userId, course.id]
      );
      courseId = result.insertId;
      summary.courses++;
    }

    await pool.execute('INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)', [userId, courseId]);

    for (const work of await google.listCoursework(accessToken, course.id)) {
      const due = google.dueDateOf(work);
      if (!due) { summary.skipped++; continue; }
      const [done] = await pool.execute(
        `INSERT INTO assignments (user_id, course_id, title, due_date, source, source_id)
         VALUES (?, ?, ?, ?, 'classroom', ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), due_date = VALUES(due_date)`,
        [userId, courseId, (work.title || 'Coursework').slice(0, 200), due, work.id]
      );
      // affectedRows: 1 = inserted, 2 = updated, 0 = unchanged
      if (done.affectedRows === 1) {
        summary.assignments++;
        summary.newDeadlines.push({ title: work.title || 'Coursework', due, course: code });
      }

      // Anything attached to the coursework is worth keeping — one click from
      // StudyHub straight to the brief, worksheet or reading.
      const workLinks = google.materialLinks(work.materials);
      if (workLinks.length || (work.description || '').trim()) {
        const workKey = `classroom:work:${work.id}`;
        if (!(await Note.exists({ 'sharedFrom.sourceId': workKey }))) {
          if (work.alternateLink) workLinks.push({ title: 'Open in Classroom', url: work.alternateLink, type: 'link' });
          await Note.create({
            courseId,
            authorId: userId,
            authorName: 'Google Classroom',
            kind: 'material',
            title: (work.title || 'Coursework').slice(0, 120),
            content: (work.description || '').trim() || 'Attached to this assignment in Classroom.',
            tags: ['classroom', 'coursework'],
            links: workLinks,
            sharedFrom: { source: 'classroom', sourceId: workKey, url: work.alternateLink || null },
          });
          summary.notes++;
        }
      }
    }

    for (const post of await google.listAnnouncements(accessToken, course.id)) {
      const body = (post.text || '').trim();
      if (!body) continue;
      const sourceKey = `classroom:${post.id}`;
      if (await Note.exists({ 'sharedFrom.sourceId': sourceKey })) continue;

      const links = google.materialLinks(post.materials);
      if (post.alternateLink) links.push({ title: 'Open in Classroom', url: post.alternateLink, type: 'link' });

      await Note.create({
        courseId,
        authorId: userId,
        authorName: 'Google Classroom',
        kind: 'announcement',
        title: body.split('\n')[0].slice(0, 120) || 'Classroom announcement',
        content: body,
        tags: ['classroom', 'announcement'],
        links,
        sharedFrom: { source: 'classroom', sourceId: sourceKey, url: post.alternateLink || null },
      });
      summary.notes++;
    }
  }

  await pool.execute('UPDATE users SET classroom_synced_at = NOW() WHERE id = ?', [userId]);
  logger.info('classroom sync finished', {
    user: userId, courses: summary.courses, assignments: summary.assignments, notes: summary.notes,
  });
  return summary;
}

module.exports = { syncUserClassroom, dueForSync, hasClassroomScope, CLASSROOM_SCOPE };
