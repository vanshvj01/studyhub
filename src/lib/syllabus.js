// Parses a pasted syllabus into units and topics.
//
// Syllabi are copied out of PDFs and course handbooks, so the shapes vary:
// "Unit 1 – Introduction", "Module II:", "1.2 Normalization", bullet lists, or a
// plain list with no grouping at all. The parser keeps whatever structure it can
// find and never loses a line.

const UNIT_PATTERNS = [
  /^\s*(unit|module|chapter|section|part)\s*[-–—:.]?\s*([IVXLC]+|\d+)\s*[-–—:.)]?\s*(.*)$/i,
];

const BULLET = /^\s*(?:[-–—*•·o]|\(?\d{1,2}[).]|\d+\.\d+\.?|\d+\))\s+/;

const clean = line => line
  .replace(BULLET, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/[.,;:\s]+$/, '')
  .trim();

/** A heading looks like "Unit 3: Transactions" — possibly with the topics after a colon. */
function asUnit(line) {
  for (const pattern of UNIT_PATTERNS) {
    const m = line.match(pattern);
    if (!m) continue;
    const label = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].toUpperCase()}`;
    return { unit: label.trim(), rest: (m[3] || '').trim() };
  }
  // "Introduction to DBMS:" on its own line also reads as a heading
  const trailing = line.match(/^\s*([A-Z][^:]{2,60}):\s*$/);
  if (trailing) return { unit: trailing[1].trim(), rest: '' };
  return null;
}

/**
 * @returns {{ topics: {unit, title, orderIndex}[], units: string[], skipped: string[] }}
 */
function parseSyllabus(text) {
  const topics = [];
  const skipped = [];
  const units = [];
  let currentUnit = null;
  let order = 0;

  const pushTopic = (title, unit) => {
    const value = clean(title);
    if (value.length < 2) return;
    if (value.length > 200) { skipped.push(value.slice(0, 60) + '…'); return; }
    // a duplicate title inside the same course would break the unique key
    if (topics.some(t => t.title.toLowerCase() === value.toLowerCase())) return;
    topics.push({ unit: unit || null, title: value, orderIndex: order++ });
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = asUnit(line);
    if (heading) {
      currentUnit = heading.unit;
      if (!units.includes(currentUnit)) units.push(currentUnit);
      if (heading.rest) {
        const inline = heading.rest.split(/[,;]| • /).map(s => s.trim()).filter(Boolean);
        if (inline.length > 1) {
          // "Unit 2: Normalization, Functional dependencies" — several topics listed
          inline.forEach(t => pushTopic(t, currentUnit));
        } else {
          // "Unit 1 - Introduction" — that is the unit's name, not a topic of its own
          currentUnit = `${currentUnit} · ${heading.rest}`;
          units[units.length - 1] = currentUnit;
        }
      }
      continue;
    }

    // A single line holding several comma-separated topics is common in handbooks.
    const parts = line.includes(',') && line.split(',').length > 2 && !BULLET.test(line)
      ? line.split(',')
      : [line];
    parts.forEach(part => pushTopic(part, currentUnit));
  }

  return { topics, units, skipped };
}

module.exports = { parseSyllabus, asUnit, clean };
