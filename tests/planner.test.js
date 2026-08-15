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

// ---------------------------------------------------------------------------
// Topic-level exam preparation
// ---------------------------------------------------------------------------
const { expandExams, topicEffort, MASTERY } = require('../src/lib/planner');

const topic = (id, extra = {}) => ({ id, title: `Topic ${id}`, difficulty: 3, status: 'not_started', ...extra });

test('a harder topic is allocated more time', () => {
  assert.ok(topicEffort(topic(1, { difficulty: 5 })) > topicEffort(topic(2, { difficulty: 1 })));
});

test('what you already know needs less time', () => {
  const order = ['not_started', 'learning', 'revised', 'mastered']
    .map(status => topicEffort(topic(1, { status })));
  assert.ok(order[0] > order[1] && order[1] > order[2] && order[2] > order[3],
    `expected decreasing effort, got ${order.join(' > ')}`);
  assert.ok(order[3] > 0, 'even a mastered topic gets a quick revision');
});

test('an exam with a syllabus becomes one item per topic', () => {
  const items = expandExams([{
    id: 7, title: 'Mid-sem', due: '2026-08-25', weight: 3, courseCode: 'CS301',
    topics: [topic(1), topic(2), topic(3)],
  }]);
  assert.equal(items.length, 3);
  assert.ok(items.every(i => i.type === 'topic'));
  assert.ok(items.every(i => i.examTitle === 'Mid-sem' && i.due === '2026-08-25'));
});

test('an exam with no portion set stays a single block', () => {
  const items = expandExams([{ id: 7, title: 'Finals', due: '2026-08-25', weight: 5, topics: [] }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'exam');
});

test('topic blocks name the topic, not the exam', () => {
  const items = expandExams([{
    id: 7, title: 'Mid-sem', due: '2026-08-25', courseCode: 'CS301',
    topics: [topic(1, { title: 'Normalization', unit: 'Unit 2' })],
  }]);
  const p = buildPlan(items, { today: TODAY, dailyMinutes: 120 });
  const block = p.days.flatMap(d => d.blocks)[0];
  assert.equal(block.title, 'Normalization');
  assert.equal(block.unit, 'Unit 2');
  assert.equal(block.examTitle, 'Mid-sem');
});

test('assignments and exam topics are planned together, nearest deadline first', () => {
  const items = [
    { id: 'a1', type: 'assignment', title: 'Lab report', due: '2026-08-24' },
    ...expandExams([{ id: 1, title: 'Mid-sem', due: '2026-08-18', topics: [topic(1)] }]),
  ];
  const p = buildPlan(items, { today: TODAY, dailyMinutes: 60 });
  assert.equal(p.days[0].blocks[0].type, 'topic', 'the exam three days out comes first');
});

test('an unrevised hard topic is scheduled before an easy mastered one', () => {
  const items = expandExams([{
    id: 1, title: 'Finals', due: '2026-08-22',
    topics: [
      topic(1, { title: 'Easy known', difficulty: 1, status: 'mastered', orderIndex: 0 }),
      topic(2, { title: 'Hard unknown', difficulty: 5, status: 'not_started', orderIndex: 1 }),
    ],
  }]);
  const p = buildPlan(items, { today: TODAY, dailyMinutes: 60 });
  assert.equal(p.days[0].blocks[0].title, 'Hard unknown');
});

test('a syllabus too large for the time left is reported per topic', () => {
  const topics = Array.from({ length: 12 }, (_, i) => topic(i + 1, { difficulty: 5 }));
  const p = buildPlan(expandExams([{ id: 1, title: 'Finals', due: '2026-08-17', topics }]),
    { today: TODAY, dailyMinutes: 60 });
  assert.ok(p.warnings.length > 0);
  assert.ok(p.warnings.every(w => w.examTitle === 'Finals'));
});

test('the totals count how many topics are in play', () => {
  const p = buildPlan(expandExams([{ id: 1, title: 'Mid', due: '2026-08-25', topics: [topic(1), topic(2)] }]),
    { today: TODAY, dailyMinutes: 120 });
  assert.equal(p.totals.topics, 2);
});

test('mastery factors stay in a sensible range', () => {
  assert.equal(MASTERY.not_started, 1);
  assert.ok(MASTERY.mastered > 0 && MASTERY.mastered < MASTERY.revised);
});
