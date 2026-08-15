const { test } = require('node:test');
const assert = require('node:assert');
const { dueForSync, hasClassroomScope } = require('../src/lib/classroomSync');

const CLASSROOM = 'openid email https://www.googleapis.com/auth/classroom.courses.readonly';
const NOW = new Date('2026-08-15T12:00:00Z');
const minutesAgo = m => new Date(NOW.getTime() - m * 60_000);

const connected = extra => ({
  google_refresh_token: 'refresh-token',
  google_scopes: CLASSROOM,
  classroom_auto_sync: 1,
  classroom_synced_at: minutesAgo(5),
  ...extra,
});

test('recognises when Classroom scopes were granted', () => {
  assert.equal(hasClassroomScope(CLASSROOM), true);
  assert.equal(hasClassroomScope('openid email profile'), false, 'plain sign-in is not enough');
  assert.equal(hasClassroomScope(null), false);
});

test('a user who has never synced is due immediately', () => {
  assert.equal(dueForSync(connected({ classroom_synced_at: null }), { now: NOW }), true);
});

test('a recent sync is not repeated', () => {
  assert.equal(dueForSync(connected({ classroom_synced_at: minutesAgo(5) }), { now: NOW, intervalMinutes: 30 }), false);
});

test('a stale sync is due again', () => {
  assert.equal(dueForSync(connected({ classroom_synced_at: minutesAgo(31) }), { now: NOW, intervalMinutes: 30 }), true);
});

test('the interval is configurable', () => {
  const user = connected({ classroom_synced_at: minutesAgo(10) });
  assert.equal(dueForSync(user, { now: NOW, intervalMinutes: 30 }), false);
  assert.equal(dueForSync(user, { now: NOW, intervalMinutes: 5 }), true);
});

test('users who cannot or should not be synced are skipped', () => {
  assert.equal(dueForSync(connected({ google_refresh_token: null }), { now: NOW }), false, 'not connected');
  assert.equal(dueForSync(connected({ google_scopes: 'openid email' }), { now: NOW }), false, 'sign-in scopes only');
  assert.equal(dueForSync(connected({ classroom_auto_sync: 0, classroom_synced_at: null }), { now: NOW }), false, 'switched off');
  assert.equal(dueForSync(null, { now: NOW }), false);
  assert.equal(dueForSync(undefined, { now: NOW }), false);
});

test('turning auto-sync off wins even when the data is stale', () => {
  const stale = connected({ classroom_auto_sync: 0, classroom_synced_at: minutesAgo(600) });
  assert.equal(dueForSync(stale, { now: NOW }), false);
});
