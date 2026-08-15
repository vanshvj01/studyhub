const { test } = require('node:test');
const assert = require('node:assert');
const { parseSyllabus } = require('../src/lib/syllabus');

test('reads units and their topics', () => {
  const { topics, units } = parseSyllabus(`
    Unit 1 - Introduction
    - Database concepts
    - ER modelling
    Unit 2 - Normalization
    • 1NF and 2NF
    • BCNF
  `);
  assert.equal(units.length, 2);
  assert.equal(topics.length, 4);
  assert.equal(topics[0].unit, 'Unit 1 · Introduction');
  assert.equal(topics[0].title, 'Database concepts');
  assert.equal(topics[3].unit, 'Unit 2 · Normalization');
});

test('a unit heading is not itself turned into a topic', () => {
  const { topics } = parseSyllabus('Unit 1 - Introduction\n- Concepts');
  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, 'Concepts');
});

test('topics listed on the heading line are split out', () => {
  const { topics } = parseSyllabus('Unit 2: Normalization, Functional dependencies, BCNF');
  assert.deepEqual(topics.map(t => t.title), ['Normalization', 'Functional dependencies', 'BCNF']);
  assert.ok(topics.every(t => t.unit === 'Unit 2'));
});

test('roman numerals, modules and chapters all count as units', () => {
  for (const heading of ['Unit III: X', 'Module 2 - X', 'Chapter 4. X', 'Section 1 X']) {
    const { units } = parseSyllabus(`${heading}\n- topic`);
    assert.equal(units.length, 1, `failed for "${heading}"`);
  }
});

test('a plain heading ending in a colon groups what follows', () => {
  const { topics, units } = parseSyllabus('Transactions:\nACID properties\nLocking');
  assert.equal(units[0], 'Transactions');
  assert.equal(topics.length, 2);
  assert.ok(topics.every(t => t.unit === 'Transactions'));
});

test('bullets and numbering are stripped', () => {
  const { topics } = parseSyllabus('- Alpha\n* Beta\n1. Gamma\n1.2 Delta\n(3) Epsilon\n• Zeta');
  assert.deepEqual(topics.map(t => t.title), ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']);
});

test('a syllabus with no units still yields topics', () => {
  const { topics, units } = parseSyllabus('Sorting\nSearching\nGraphs');
  assert.equal(units.length, 0);
  assert.equal(topics.length, 3);
  assert.equal(topics[0].unit, null);
});

test('duplicates are dropped so the unique key cannot be violated', () => {
  const { topics } = parseSyllabus('- Sorting\n- sorting\n- SORTING');
  assert.equal(topics.length, 1);
});

test('order is preserved for scheduling', () => {
  const { topics } = parseSyllabus('- Sorting\n- Searching\n- Graphs');
  assert.deepEqual(topics.map(t => t.orderIndex), [0, 1, 2]);
  assert.deepEqual(topics.map(t => t.title), ['Sorting', 'Searching', 'Graphs']);
});

test('single characters are treated as noise, not topics', () => {
  assert.deepEqual(parseSyllabus('- A\n- B').topics, []);
});

test('blank input is handled', () => {
  assert.deepEqual(parseSyllabus('').topics, []);
  assert.deepEqual(parseSyllabus(null).topics, []);
});
