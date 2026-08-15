// Disconnecting Google Classroom hides the imported data rather than deleting it.
//
// A student who disconnects by accident — or reconnects a week later — should not
// lose a semester of deadlines. Imported rows are marked with `archived_at`,
// filtered out of every read, restorable from the profile, and permanently
// removed once the grace period expires.
const { pool } = require('../config/db');
const Note = require('../models/Note');
const { logger } = require('./logger');

const RETENTION_DAYS = Number(process.env.CLASSROOM_RETENTION_DAYS ?? 30);
const DAY_MS = 86_400_000;

/** Days left before archived data is deleted for good. 0 means it is due now. */
function daysUntilPurge(archivedAt, { now = new Date(), retentionDays = RETENTION_DAYS } = {}) {
  if (!archivedAt) return null;
  const elapsed = (now - new Date(archivedAt)) / DAY_MS;
  return Math.max(0, Math.ceil(retentionDays - elapsed));
}

const isExpired = (archivedAt, opts = {}) =>
  Boolean(archivedAt) && daysUntilPurge(archivedAt, opts) === 0;

/** Hides everything imported from Classroom for one student. */
async function archiveForUser(userId) {
  const [courses] = await pool.execute(
    `UPDATE courses SET archived_at = NOW()
     WHERE source = 'classroom' AND created_by = ? AND archived_at IS NULL`,
    [userId]
  );
  const [assignments] = await pool.execute(
    `UPDATE assignments SET archived_at = NOW()
     WHERE source = 'classroom' AND user_id = ? AND archived_at IS NULL`,
    [userId]
  );
  const notes = await Note.updateMany(
    { authorId: userId, 'sharedFrom.source': 'classroom', archivedAt: null },
    { archivedAt: new Date() }
  );
  await pool.execute('UPDATE users SET classroom_archived_at = NOW() WHERE id = ?', [userId]);

  const summary = {
    courses: courses.affectedRows,
    assignments: assignments.affectedRows,
    notes: notes.modifiedCount ?? 0,
  };
  logger.info('classroom data archived', { user: userId, ...summary, retentionDays: RETENTION_DAYS });
  return summary;
}

/** Brings it all back. Also runs before a re-import, so nothing is duplicated. */
async function restoreForUser(userId) {
  const [courses] = await pool.execute(
    `UPDATE courses SET archived_at = NULL WHERE source = 'classroom' AND created_by = ? AND archived_at IS NOT NULL`,
    [userId]
  );
  const [assignments] = await pool.execute(
    `UPDATE assignments SET archived_at = NULL WHERE source = 'classroom' AND user_id = ? AND archived_at IS NOT NULL`,
    [userId]
  );
  const notes = await Note.updateMany(
    { authorId: userId, 'sharedFrom.source': 'classroom', archivedAt: { $ne: null } },
    { archivedAt: null }
  );
  await pool.execute('UPDATE users SET classroom_archived_at = NULL WHERE id = ?', [userId]);

  const summary = {
    courses: courses.affectedRows,
    assignments: assignments.affectedRows,
    notes: notes.modifiedCount ?? 0,
  };
  logger.info('classroom data restored', { user: userId, ...summary });
  return summary;
}

/** What is sitting in the archive, and how long it has left. */
async function archiveStatus(userId) {
  const [[user]] = await pool.execute(
    'SELECT classroom_archived_at FROM users WHERE id = ?', [userId]
  );
  if (!user?.classroom_archived_at) {
    return { archived: false, retentionDays: RETENTION_DAYS };
  }
  const [[counts]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM courses WHERE source = 'classroom' AND created_by = ? AND archived_at IS NOT NULL) AS courses,
       (SELECT COUNT(*) FROM assignments WHERE source = 'classroom' AND user_id = ? AND archived_at IS NOT NULL) AS assignments`,
    [userId, userId]
  );
  const notes = await Note.countDocuments({
    authorId: userId, 'sharedFrom.source': 'classroom', archivedAt: { $ne: null },
  });

  const archivedAt = user.classroom_archived_at;
  const daysLeft = daysUntilPurge(archivedAt);
  return {
    archived: true,
    archivedAt,
    daysLeft,
    deleteOn: new Date(new Date(archivedAt).getTime() + RETENTION_DAYS * DAY_MS),
    retentionDays: RETENTION_DAYS,
    counts: { courses: Number(counts.courses), assignments: Number(counts.assignments), notes },
  };
}

/** Deletes anything that has been archived longer than the retention period. */
async function purgeExpired({ retentionDays = RETENTION_DAYS } = {}) {
  const [users] = await pool.execute(
    `SELECT id, classroom_archived_at FROM users
     WHERE classroom_archived_at IS NOT NULL
       AND classroom_archived_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [retentionDays]
  );
  if (users.length === 0) return { users: 0, courses: 0, assignments: 0, notes: 0 };

  const total = { users: users.length, courses: 0, assignments: 0, notes: 0 };
  for (const user of users) {
    // Assignments go first: they reference courses.
    const [assignments] = await pool.execute(
      `DELETE FROM assignments WHERE source = 'classroom' AND user_id = ? AND archived_at IS NOT NULL`,
      [user.id]
    );
    const [courses] = await pool.execute(
      `DELETE FROM courses WHERE source = 'classroom' AND created_by = ? AND archived_at IS NOT NULL`,
      [user.id]
    );
    const notes = await Note.deleteMany({
      authorId: user.id, 'sharedFrom.source': 'classroom', archivedAt: { $ne: null },
    });
    await pool.execute('UPDATE users SET classroom_archived_at = NULL WHERE id = ?', [user.id]);

    total.assignments += assignments.affectedRows;
    total.courses += courses.affectedRows;
    total.notes += notes.deletedCount ?? 0;
  }
  logger.info('expired classroom archives purged', { ...total, retentionDays });
  return total;
}

module.exports = { archiveForUser, restoreForUser, archiveStatus, purgeExpired, daysUntilPurge, isExpired, RETENTION_DAYS };
