const { test } = require('node:test');
const assert = require('node:assert');
const { daysUntilPurge, isExpired, RETENTION_DAYS } = require('../src/lib/classroomArchive');

const NOW = new Date('2026-08-31T12:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86_400_000);

test('nothing archived means no countdown', () => {
  assert.equal(daysUntilPurge(null, { now: NOW }), null);
  assert.equal(isExpired(null, { now: NOW }), false);
});

test('a fresh archive has the full grace period', () => {
  assert.equal(daysUntilPurge(NOW, { now: NOW, retentionDays: 30 }), 30);
});

test('the countdown runs down day by day', () => {
  assert.equal(daysUntilPurge(daysAgo(1), { now: NOW, retentionDays: 30 }), 29);
  assert.equal(daysUntilPurge(daysAgo(29), { now: NOW, retentionDays: 30 }), 1);
});

test('data is not expired until the period is fully served', () => {
  assert.equal(isExpired(daysAgo(29), { now: NOW, retentionDays: 30 }), false);
  assert.equal(isExpired(daysAgo(30), { now: NOW, retentionDays: 30 }), true);
});

test('an overdue archive reports zero rather than a negative number', () => {
  assert.equal(daysUntilPurge(daysAgo(45), { now: NOW, retentionDays: 30 }), 0);
  assert.equal(isExpired(daysAgo(45), { now: NOW, retentionDays: 30 }), true);
});

test('the retention period is configurable', () => {
  assert.equal(daysUntilPurge(daysAgo(5), { now: NOW, retentionDays: 7 }), 2);
  assert.equal(isExpired(daysAgo(5), { now: NOW, retentionDays: 7 }), false);
  assert.equal(isExpired(daysAgo(8), { now: NOW, retentionDays: 7 }), true);
});

test('the default grace period is 30 days', () => {
  assert.equal(RETENTION_DAYS, 30);
});
