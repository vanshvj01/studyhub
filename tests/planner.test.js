const { test } = require('node:test');
const assert = require('node:assert');
const { buildPlan } = require('../src/lib/planner');

const TODAY = '2026-08-15';
const plan = (items, opts = {}) => buildPlan(items, { today: TODAY, dailyMinutes: 120, horizonDays: 14, ...opts });

test('an empty list produces an empty but well-formed plan', () => {
  const p = plan([]);
  assert.equal(p.days.length, 14);
  assert.equal(p.totals.scheduledMinutes, 0);
  assert.deepEqual(p.warnings, []);
});

test('past deadlines are ignored', () => {
  const p = plan([{ id: 1, type: 'assignment', title: 'Old', due: '2026-08-01' }]);
  assert.equal(p.totals.items, 0);
});

test('work is scheduled before the deadline, never after', () => {
  const p = plan([{ id: 1, type: 'assignment', title: 'ER diagram', due: '2026-08-20' }]);
  const scheduled = p.days.filter(d => d.blocks.length);
  assert.ok(scheduled.length > 0, 'something was scheduled');
  assert.ok(scheduled.every(d => d.date < '2026-08-20'), 'nothing lands on or after the due date');
});

test('a heavier exam gets more total time than a light assignment', () => {
  const p = plan([
    { id: 1, type: 'assignment', title: 'Lab', due: '2026-08-25', weight: 1 },
    { id: 2, type: 'exam', title: 'Finals', due: '2026-08-27', weight: 5 },
  ]);
  const minutesFor = id => p.days.flatMap(d => d.blocks).filter(b => b.id === id).reduce((s, b) => s + b.minutes, 0);
  assert.ok(minutesFor(2) > minutesFor(1), 'the exam is allocated more time');
});

test('daily capacity is never exceeded', () => {
  const p = plan([
    { id: 1, type: 'exam', title: 'A', due: '2026-08-18', weight: 5 },
    { id: 2, type: 'exam', title: 'B', due: '2026-08-19', weight: 5 },
    { id: 3, type: 'exam', title: 'C', due: '2026-08-20', weight: 5 },
  ], { dailyMinutes: 60 });
  assert.ok(p.days.every(d => d.totalMinutes <= 60), 'no day is overbooked');
});

test('impossible workloads are reported rather than silently dropped', () => {
  const p = plan([{ id: 1, type: 'exam', title: 'Crammed', due: '2026-08-16', weight: 5 }], { dailyMinutes: 60 });
  assert.ok(p.warnings.length > 0, 'a warning is raised');
  assert.match(p.warnings[0].reason, /could not be scheduled/);
});

test('the nearest deadline gets the earliest slot', () => {
  const p = plan([
    { id: 'far', type: 'assignment', title: 'Far', due: '2026-08-28' },
    { id: 'near', type: 'assignment', title: 'Near', due: '2026-08-17' },
  ], { dailyMinutes: 60 });
  assert.equal(p.days[0].blocks[0].id, 'near');
});

test('blocks are never shorter than the minimum useful session', () => {
  const p = plan([{ id: 1, type: 'assignment', title: 'X', due: '2026-08-29' }], { minBlock: 30 });
  assert.ok(p.days.flatMap(d => d.blocks).every(b => b.minutes >= 30));
});

test('every block carries the days remaining, for display', () => {
  const p = plan([{ id: 1, type: 'exam', title: 'Mid-sem', due: '2026-08-22', weight: 3 }]);
  const first = p.days.flatMap(d => d.blocks)[0];
  assert.equal(typeof first.daysLeft, 'number');
  assert.ok(first.daysLeft > 0);
});
