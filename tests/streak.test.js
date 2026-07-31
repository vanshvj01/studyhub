const { test } = require('node:test');
const assert = require('node:assert');
const { computeStreak } = require('../src/lib/streak');

const NOW = new Date('2026-07-31T10:00:00');
const ago = n => { const d = new Date(NOW); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

test('no study days means no streak', () => {
  assert.equal(computeStreak([], NOW), 0);
  assert.equal(computeStreak(null, NOW), 0);
});

test('counts consecutive days ending today', () => {
  assert.equal(computeStreak([ago(0), ago(1), ago(2)], NOW), 3);
});

test('a streak survives until the end of the next day', () => {
  assert.equal(computeStreak([ago(1), ago(2)], NOW), 2);
});

test('a gap ends the streak', () => {
  assert.equal(computeStreak([ago(0), ago(1), ago(3), ago(4)], NOW), 2);
});

test('an old streak is dead', () => {
  assert.equal(computeStreak([ago(5), ago(6)], NOW), 0);
});

test('duplicate days do not inflate the count', () => {
  assert.equal(computeStreak([ago(0), ago(0), ago(1)], NOW), 2);
});
