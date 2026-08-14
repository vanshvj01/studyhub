const { test } = require('node:test');
const assert = require('node:assert');
const { parseTimetable, findDate, findCourseCode, findTime } = require('../src/lib/timetable');

test('reads the date formats students actually paste', () => {
  assert.equal(findDate('CS301 2026-09-12'), '2026-09-12');
  assert.equal(findDate('12/09/2026 DBMS'), '2026-09-12', 'day-first, as used in India');
  assert.equal(findDate('12-9-26 DBMS'), '2026-09-12');
  assert.equal(findDate('12 Sep 2026 DBMS'), '2026-09-12');
  assert.equal(findDate('12th September 2026'), '2026-09-12');
  assert.equal(findDate('Sep 12, 2026 DBMS'), '2026-09-12');
  assert.equal(findDate('no date here'), null);
});

test('picks out course codes and times', () => {
  assert.equal(findCourseCode('CS301 Database Systems'), 'CS301');
  assert.equal(findCourseCode('IT-42 Networks'), 'IT42');
  assert.equal(findCourseCode('Database Systems'), null);
  assert.equal(findTime('10:30 am DBMS'), '10:30');
  assert.equal(findTime('2:00 pm DBMS'), '14:00');
  assert.equal(findTime('DBMS'), null);
});

test('parses a realistic pasted timetable', () => {
  const { rows } = parseTimetable(`
    Date        Subject                 Time
    12/09/2026  CS301 Database Systems  10:00 am
    14/09/2026  CS302 Operating Systems 2:00 pm
    16 Sep 2026 CS303 Computer Networks
  `);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, '2026-09-12');
  assert.equal(rows[0].courseCode, 'CS301');
  assert.equal(rows[0].time, '10:00');
  assert.ok(rows[0].title.includes('Database Systems'));
  assert.equal(rows[2].time, null);
});

test('lines without a date are reported, not silently dropped', () => {
  const { rows, skipped } = parseTimetable('12/09/2026 DBMS\nRoom allocation to be announced');
  assert.equal(rows.length, 1);
  assert.equal(skipped.length, 1);
});

test('the header row is ignored', () => {
  const { rows } = parseTimetable('Date | Subject | Time\n12/09/2026 | DBMS | 10:00');
  assert.equal(rows.length, 1);
});

test('a title always comes out, even from a bare date line', () => {
  const { rows } = parseTimetable('2026-09-12');
  assert.equal(rows[0].title, 'Exam');
});
