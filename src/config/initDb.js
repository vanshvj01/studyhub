// Applies db/schema.sql (and small column migrations) at startup.
// Everything here is idempotent, so it is safe to run on every boot. This
// removes the dependency on Docker's docker-entrypoint-initdb.d hook, which
// only fires when the MySQL data volume is brand new — and silently does
// nothing if the volume already exists.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { logger } = require('../lib/logger');
const { mysqlConfig } = require('./db');

// Columns added after the first release. CREATE TABLE IF NOT EXISTS will not
// add these to an existing table, so they are applied separately.
const COLUMN_MIGRATIONS = [
  ['users', 'bio', "ALTER TABLE users ADD COLUMN bio VARCHAR(300) NULL"],
  ['users', 'college', "ALTER TABLE users ADD COLUMN college VARCHAR(120) NULL"],
  ['users', 'avatar', "ALTER TABLE users ADD COLUMN avatar MEDIUMTEXT NULL"],
  ['users', 'daily_goal_minutes', "ALTER TABLE users ADD COLUMN daily_goal_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60"],
];

async function initDb() {
  const database = process.env.MYSQL_DATABASE || 'studyhub';
  const conn = await mysql.createConnection(mysqlConfig({ database, multipleStatements: true }));

  try {
    const dbDir = path.join(__dirname, '..', '..', 'db');
    await conn.query(fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8'));

    for (const [table, column, sql] of COLUMN_MIGRATIONS) {
      const [rows] = await conn.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
        [database, table, column]
      );
      if (rows.length === 0) {
        await conn.query(sql);
        logger.info('schema migration applied', { column: `${table}.${column}` });
      }
    }

    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
    if (n === 0) {
      await conn.query(fs.readFileSync(path.join(dbDir, 'seed.sql'), 'utf8'));
      logger.info('schema applied, demo data seeded');
    } else {
      logger.info('schema up to date');
    }
  } finally {
    await conn.end();
  }
}

module.exports = { initDb };
