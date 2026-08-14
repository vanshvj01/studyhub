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
];

// Unique indexes are added only after the corresponding column is backfilled.
const INDEX_MIGRATIONS = [
  ['users', 'uq_users_username', 'ALTER TABLE users ADD UNIQUE KEY uq_users_username (username)'],
  ['users', 'uq_users_referral', 'ALTER TABLE users ADD UNIQUE KEY uq_users_referral (referral_code)'],
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

    await backfillAccounts(conn);

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
