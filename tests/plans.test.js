const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAccess, nextAccessUntil, getPlan, listPlans, formatPrice, FREE_LIMITS, PRO_LIMITS } = require('../src/lib/plans');

const NOW = new Date('2026-08-15T12:00:00Z');
const inDays = n => new Date(NOW.getTime() + n * 86_400_000);
const row = (extra = {}) => ({ source: 'exam_pass', plan_code: 'exam_pass_30', access_until: inDays(10), revoked_at: null, ...extra });

test('no entitlements means the free tier', () => {
  const access = resolveAccess([], NOW);
  assert.equal(access.pro, false);
  assert.equal(access.limits.planHorizonDays, FREE_LIMITS.planHorizonDays);
  assert.deepEqual(access.sources, []);
});

test('a live entitlement unlocks the pro limits', () => {
  const access = resolveAccess([row()], NOW);
  assert.equal(access.pro, true);
  assert.equal(access.limits.planHorizonDays, PRO_LIMITS.planHorizonDays);
  assert.equal(access.limits.classroomAutoSync, true);
});

test('an expired pass does not', () => {
  assert.equal(resolveAccess([row({ access_until: inDays(-1) })], NOW).pro, false);
});

test('a revoked entitlement is ignored even if still in date', () => {
  assert.equal(resolveAccess([row({ revoked_at: inDays(-2) })], NOW).pro, false);
});

test('the furthest end date wins when several overlap', () => {
  const access = resolveAccess([row({ access_until: inDays(3) }), row({ access_until: inDays(40) })], NOW);
  assert.equal(new Date(access.until).getTime(), inDays(40).getTime());
});

test('access from someone else is reported with its source', () => {
  const access = resolveAccess([row({ source: 'family', granted_by: 9 })], NOW);
  assert.deepEqual(access.sources, ['family']);
  assert.equal(access.grantedBy, 9);
});

test('buying while still covered extends rather than wasting the overlap', () => {
  const until = nextAccessUntil(inDays(10), 30, NOW);
  assert.equal(until.getTime(), inDays(40).getTime(), 'the new 30 days start when the old access ends');
});

test('buying after a lapse starts from today', () => {
  const until = nextAccessUntil(inDays(-5), 30, NOW);
  assert.equal(until.getTime(), inDays(30).getTime());
});

test('a first purchase starts from today', () => {
  assert.equal(nextAccessUntil(null, 30, NOW).getTime(), inDays(30).getTime());
});

test('the catalogue prices in whole rupees, stored as paise', () => {
  assert.equal(getPlan('exam_pass_30').amountPaise, 7900);
  assert.equal(formatPrice(7900), '₹79');
  assert.equal(formatPrice(19900), '₹199');
  assert.equal(getPlan('nonexistent'), null);
});

test('every listed plan has a price, a duration and a name', () => {
  for (const plan of listPlans()) {
    assert.ok(plan.amountPaise > 0 && plan.days > 0 && plan.name, `incomplete plan: ${plan.code}`);
  }
});

test('the free tier is usable, not crippled', () => {
  assert.ok(FREE_LIMITS.planHorizonDays >= 7, 'a week of planning is still useful');
  assert.ok(FREE_LIMITS.examsWithPortions >= 1, 'one exam can always be scoped');
});
