// Applies db/schema.sql plus column migrations and one-off backfills at startup.
// Everything here is idempotent, so it is safe to run on every boot. This
// removes the dependency on Docker's docker-entrypoint-initdb.d hook, which
// only fires when the MySQL data volume is brand new — and silently does
// nothing if the volume already exists.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { logger } = require('../lib/logger');
const { mysqlConfig } = require('./db');
const { shortCode } = require('../lib/ids');
const { usernameFromEmail } = require('../lib/accounts');

// Columns added after the first release. CREATE TABLE IF NOT EXISTS will not
// add these to an existing table, so they are applied separately.
const COLUMN_MIGRATIONS = [
  ['users', 'bio', 'ALTER TABLE users ADD COLUMN bio VARCHAR(300) NULL'],
  ['users', 'college', 'ALTER TABLE users ADD COLUMN college VARCHAR(120) NULL'],
  ['users', 'avatar', 'ALTER TABLE users ADD COLUMN avatar MEDIUMTEXT NULL'],
  ['users', 'daily_goal_minutes', 'ALTER TABLE users ADD COLUMN daily_goal_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60'],
  ['users', 'username', 'ALTER TABLE users ADD COLUMN username VARCHAR(20) NULL'],
  ['users', 'role', "ALTER TABLE users ADD COLUMN role ENUM('student','parent') NOT NULL DEFAULT 'student'"],
  ['users', 'email_verified', 'ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'verification_token', 'ALTER TABLE users ADD COLUMN verification_token CHAR(48) NULL'],
  ['users', 'verified_at', 'ALTER TABLE users ADD COLUMN verified_at DATETIME NULL'],
  ['users', 'referral_code', 'ALTER TABLE users ADD COLUMN referral_code CHAR(8) NULL'],
  ['users', 'referred_by', 'ALTER TABLE users ADD COLUMN referred_by INT UNSIGNED NULL'],
  ['users', 'phone', 'ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL'],
  ['users', 'google_id', 'ALTER TABLE users ADD COLUMN google_id VARCHAR(40) NULL'],
  ['users', 'reset_token', 'ALTER TABLE users ADD COLUMN reset_token CHAR(48) NULL'],
  ['users', 'reset_expires', 'ALTER TABLE users ADD COLUMN reset_expires DATETIME NULL'],
  ['users', 'google_refresh_token', 'ALTER TABLE users ADD COLUMN google_refresh_token TEXT NULL'],
  ['users', 'classroom_synced_at', 'ALTER TABLE users ADD COLUMN classroom_synced_at DATETIME NULL'],
  ['users', 'google_scopes', 'ALTER TABLE users ADD COLUMN google_scopes TEXT NULL'],
  ['users', 'classroom_auto_sync', 'ALTER TABLE users ADD COLUMN classroom_auto_sync TINYINT(1) NOT NULL DEFAULT 1'],
  // password_hash becomes optional: a Google-only account never sets one
  ['courses', 'source_id', "ALTER TABLE courses ADD COLUMN source_id VARCHAR(64) NULL"],
  ['courses', 'source', "ALTER TABLE courses ADD COLUMN source ENUM('manual','classroom') NOT NULL DEFAULT 'manual'"],
  ['assignments', 'source_id', "ALTER TABLE assignments ADD COLUMN source_id VARCHAR(64) NULL"],
  ['assignments', 'source', "ALTER TABLE assignments ADD COLUMN source ENUM('manual','classroom') NOT NULL DEFAULT 'manual'"],
];

// Unique indexes are added only after the corresponding column is backfilled.
const INDEX_MIGRATIONS = [
  ['users', 'uq_users_username', 'ALTER TABLE users ADD UNIQUE KEY uq_users_username (username)'],
  ['users', 'uq_users_referral', 'ALTER TABLE users ADD UNIQUE KEY uq_users_referral (referral_code)'],
  ['users', 'uq_users_phone', 'ALTER TABLE users ADD UNIQUE KEY uq_users_phone (phone)'],
  ['users', 'uq_users_google', 'ALTER TABLE users ADD UNIQUE KEY uq_users_google (google_id)'],
  ['courses', 'uq_courses_source', 'ALTER TABLE courses ADD UNIQUE KEY uq_courses_source (source, source_id)'],
  ['assignments', 'uq_assignments_source', 'ALTER TABLE assignments ADD UNIQUE KEY uq_assignments_source (user_id, source, source_id)'],
];

async function hasColumn(conn, database, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [database, table, column]
  );
  return rows.length > 0;
}

async function hasIndex(conn, database, table, index) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
    [database, table, index]
  );
  return rows.length > 0;
}

/** Gives every pre-existing row a username and a referral code. */
async function backfillAccounts(conn) {
  const [rows] = await conn.query(
    'SELECT id, email, username, referral_code FROM users WHERE username IS NULL OR referral_code IS NULL'
  );
  if (rows.length === 0) return;

  const [taken] = await conn.query('SELECT username FROM users WHERE username IS NOT NULL');
  const used = new Set(taken.map(r => r.username));

  for (const row of rows) {
    let username = row.username;
    if (!username) {
      const base = usernameFromEmail(row.email);
      username = base;
      let n = 1;
      while (used.has(username)) username = `${base.slice(0, 17)}${n++}`;
      used.add(username);
    }
    const referral = row.referral_code || shortCode(8);
    await conn.query(
      'UPDATE users SET username = ?, referral_code = ?, email_verified = 1, verified_at = NOW() WHERE id = ?',
      [username, referral, row.id]
    );
  }
  logger.info('backfilled accounts', { rows: rows.length });
}

/**
 * The old `progress` table held one row per (user, course, topic) with a status.
 * The syllabus supersedes it, so those rows are copied across once — nothing is
 * lost, and the tracker a student already filled in keeps working.
 */
async function migrateProgressToSyllabus(conn) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM syllabus_topics');
  if (n > 0) return;                                   // already migrated

  const [rows] = await conn.query('SELECT user_id, course_id, topic, status FROM progress ORDER BY id');
  if (rows.length === 0) return;

  const statusMap = { not_started: 'not_started', in_progress: 'learning', completed: 'mastered' };
  const orderByCourse = new Map();

  for (const row of rows) {
    const key = `${row.user_id}:${row.course_id}`;
    const order = orderByCourse.get(key) ?? 0;
    orderByCourse.set(key, order + 1);
    await conn.query(
      `INSERT IGNORE INTO syllabus_topics (user_id, course_id, title, order_index, status)
       VALUES (?, ?, ?, ?, ?)`,
      [row.user_id, row.course_id, row.topic, order, statusMap[row.status] || 'not_started']
    );
  }
  logger.info('migrated progress rows into the syllabus', { rows: rows.length });
}

async function initDb() {
  const database = process.env.MYSQL_DATABASE || 'studyhub';
  const conn = await mysql.createConnection(mysqlConfig({ database, multipleStatements: true }));

  try {
    const dbDir = path.join(__dirname, '..', '..', 'db');
    await conn.query(fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8'));

    for (const [table, column, sql] of COLUMN_MIGRATIONS) {
      if (!(await hasColumn(conn, database, table, column))) {
        await conn.query(sql);
        logger.info('schema migration applied', { column: `${table}.${column}` });
      }
    }

    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
    if (n === 0) {
      await conn.query(fs.readFileSync(path.join(dbDir, 'seed.sql'), 'utf8'));
      logger.info('schema applied, demo data seeded');
    }

    // Google-only accounts never set a password, so the column must allow NULL.
    const [[pwCol]] = await conn.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'users' AND column_name = 'password_hash'`,
      [database]
    );
    if (pwCol && pwCol.is_nullable === 'NO') {
      await conn.query('ALTER TABLE users MODIFY password_hash VARCHAR(255) NULL');
      logger.info('schema migration applied', { column: 'users.password_hash (now nullable)' });
    }

    await backfillAccounts(conn);
    await migrateProgressToSyllabus(conn);

    for (const [table, index, sql] of INDEX_MIGRATIONS) {
      if (!(await hasIndex(conn, database, table, index))) {
        await conn.query(sql);
        logger.info('index created', { index });
      }
    }

    // referred_by points at another user; added late so it needs its own check
    if (!(await hasIndex(conn, database, 'users', 'fk_users_referrer'))) {
      await conn.query(
        'ALTER TABLE users ADD CONSTRAINT fk_users_referrer FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL'
      );
      logger.info('index created', { index: 'fk_users_referrer' });
    }

    logger.info('schema up to date');
  } finally {
    await conn.end();
  }
}

module.exports = { initDb };
