// Guards the one mistake that can take the whole deployment down: schema.sql is
// replayed on every boot, so every statement in it must be safe to run twice.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
const withoutComments = schema.replace(/^\s*--.*$/gm, '');
const statements = withoutComments.split(';').map(s => s.trim()).filter(Boolean);

test('every CREATE TABLE uses IF NOT EXISTS', () => {
  const bare = statements.filter(s => /^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(s));
  assert.deepEqual(bare.map(s => s.split('\n')[0]), [],
    'CREATE TABLE without IF NOT EXISTS fails on the second boot');
});

test('no bare CREATE INDEX — MySQL has no IF NOT EXISTS for it', () => {
  const indexes = statements.filter(s => /^CREATE\s+(UNIQUE\s+)?INDEX/i.test(s));
  assert.deepEqual(indexes.map(s => s.split('\n')[0]), [],
    'move indexes into initDb INDEX_MIGRATIONS, which checks information_schema first');
});

test('no ALTER TABLE in the schema file either', () => {
  const alters = statements.filter(s => /^ALTER\s+TABLE/i.test(s));
  assert.deepEqual(alters.map(s => s.split('\n')[0]), [],
    'ALTER belongs in COLUMN_MIGRATIONS, which is guarded');
});

test('inserts are guarded so re-running cannot duplicate rows', () => {
  const inserts = statements.filter(s => /^INSERT\s+INTO/i.test(s));
  for (const statement of inserts) {
    assert.match(statement, /INSERT\s+IGNORE|ON\s+DUPLICATE\s+KEY/i,
      `unguarded INSERT in schema.sql: ${statement.slice(0, 60)}`);
  }
});

test('the schema still defines the tables the app depends on', () => {
  for (const table of ['users', 'courses', 'enrollments', 'assignments', 'exams',
                       'study_sessions', 'grades', 'syllabus_topics', 'exam_topics',
                       'guardian_links', 'student_invites']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
      `${table} is missing from schema.sql`);
  }
});
