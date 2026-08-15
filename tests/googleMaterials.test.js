const { test } = require('node:test');
const assert = require('node:assert');
const { materialLinks, courseCodeOf, dueDateOf } = require('../src/lib/google');

test('drive files, links, videos and forms all become clickable links', () => {
  const links = materialLinks([
    { driveFile: { driveFile: { title: 'Unit 2 notes.pdf', alternateLink: 'https://drive.google.com/file/d/a/view' } } },
    { link: { url: 'https://example.edu/reading', title: 'Extra reading' } },
    { youtubeVideo: { title: 'Normalization', alternateLink: 'https://youtu.be/xyz' } },
    { form: { title: 'Quiz 1', formUrl: 'https://forms.gle/q1' } },
  ]);
  assert.deepEqual(links.map(l => l.type), ['drive', 'link', 'youtube', 'form']);
  assert.ok(links.every(l => l.url && l.title));
});

test('an attachment with no url is dropped rather than rendered as a dead link', () => {
  assert.deepEqual(materialLinks([{ driveFile: { driveFile: { title: 'broken' } } }]), []);
});

test('an untitled link falls back to showing its url', () => {
  const [link] = materialLinks([{ link: { url: 'https://example.edu/x' } }]);
  assert.equal(link.title, 'https://example.edu/x');
});

test('no materials is not an error', () => {
  assert.deepEqual(materialLinks(), []);
  assert.deepEqual(materialLinks([]), []);
  assert.deepEqual(materialLinks([{}]), []);
});

test('course codes are pulled from the section or the name', () => {
  assert.equal(courseCodeOf({ name: 'Database Systems', section: 'CS301' }), 'CS301');
  assert.equal(courseCodeOf({ name: 'CS 302 Operating Systems' }), 'CS302');
  assert.equal(courseCodeOf({ name: 'Discrete Mathematics' }), 'DM', 'falls back to initials');
});

test('a due date only counts when Classroom gives all three parts', () => {
  assert.equal(dueDateOf({ dueDate: { year: 2026, month: 9, day: 5 } }), '2026-09-05');
  assert.equal(dueDateOf({ dueDate: { year: 2026, month: 9 } }), null);
  assert.equal(dueDateOf({}), null);
});
