// Parses a pasted exam timetable. Students copy these out of PDFs, emails and
// notice-board photos, so the format is never consistent — the parser accepts a
// date and a subject on the same line, in whatever order, and ignores the rest.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = n => String(n).padStart(2, '0');

// Only real month names may be stripped from a title. Matching any word here
// would eat subject names: "Operating Systems 10:00" reads as "<month> <day>".
const MONTH_WORD = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

/** Finds a date anywhere in a line. Returns 'YYYY-MM-DD' or null. */
function findDate(line, defaultYear) {
  const year = defaultYear || new Date().getFullYear();

  // 2026-09-12
  let m = line.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // 12/09/2026 or 12-9-26 — day first, which is the convention in India
  m = line.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${yr}-${pad(m[2])}-${pad(m[1])}`;
  }

  // 12 Sep 2026 / 12th September
  m = line.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_WORD})\\.?\\s*(\\d{4})?\\b`, 'i'));
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return `${m[3] || year}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`;
  }

  // Sep 12, 2026
  m = line.match(new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?\\b`, 'i'));
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return `${m[3] || year}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`;
  }
  return null;
}

/** Course codes look like CS301, IT-42, MA 101. */
const findCourseCode = line => (line.match(/\b([A-Z]{2,4}[\s-]?\d{2,4})\b/) || [])[1]?.replace(/[\s-]/g, '') || null;

const findTime = line => {
  const m = line.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (!m) return null;
  let hour = Number(m[1]);
  if (m[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (m[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
  return `${pad(hour)}:${m[2]}`;
};

/**
 * @returns {{ rows: object[], skipped: string[] }}
 * rows: { title, date, time, courseCode, raw }
 */
function parseTimetable(text, options = {}) {
  const rows = [];
  const skipped = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length < 4) continue;
    // header rows: no digits at all, or obviously a column header
    if (/^(date|day|subject|course|exam|time|sr\.?\s*no)\b/i.test(line) && !/\d{4}/.test(line)) continue;

    const date = findDate(line, options.year);
    if (!date) { skipped.push(line); continue; }

    const courseCode = findCourseCode(line);
    const time = findTime(line);

    // The title is whatever remains once the date, time and separators are gone.
    let title = line
      .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
      .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
      .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\.?\\s*\\d{0,4}\\b`, 'gi'), ' ')
      .replace(new RegExp(`\\b${MONTH_WORD}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*\\d{0,4}\\b`, 'gi'), ' ')
      .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, ' ')
      .replace(/\b(to|from|at|on)\b/gi, ' ')
      .replace(/[|,;\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
      .trim();

    if (!title) title = courseCode || 'Exam';
    rows.push({ title, date, time, courseCode, raw: line });
  }

  return { rows, skipped };
}

module.exports = { parseTimetable, findDate, findCourseCode, findTime };
