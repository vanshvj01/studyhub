const { test } = require('node:test');
const assert = require('node:assert');
const { letterFor, weightedAverage, percentOf, overallAverage } = require('../src/lib/marks');

test('maps percentages to letter grades at the band edges', () => {
  assert.equal(letterFor(90), 'A+');
  assert.equal(letterFor(89.9), 'A');
  assert.equal(letterFor(70), 'B');
  assert.equal(letterFor(39.9), 'F');
  assert.equal(letterFor(0), 'F');
});

test('percentOf guards against a zero total', () => {
  assert.equal(percentOf(29, 40), 72.5);
  assert.equal(percentOf(10, 0), 0);
});

test('weightedAverage respects weights', () => {
  // 50% at weight 1, 100% at weight 3 -> 87.5
  assert.equal(weightedAverage([{ pct: 50, weight: 1 }, { pct: 100, weight: 3 }]), 87.5);
});

test('weightedAverage is 0 with no items or no weight', () => {
  assert.equal(weightedAverage([]), 0);
  assert.equal(weightedAverage([{ pct: 80, weight: 0 }]), 0);
});

test('overallAverage means the per-course averages', () => {
  assert.equal(overallAverage([{ average: 80 }, { average: 60 }]), 70);
  assert.equal(overallAverage([]), 0);
});
