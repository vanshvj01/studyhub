// Uploads are the one place where a student hands the app a file it did not
// create. Everything here is about failing readably: a photo, a scan, a
// spreadsheet, an empty file — each should come back with a sentence a student
// can act on rather than an empty result.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { extractText, classify, decodeDataUrl, tidy } = require('../src/lib/extract');
const { parseTimetable } = require('../src/lib/timetable');
const { parseSyllabus } = require('../src/lib/syllabus');

const asDataUrl = (mime, buffer) => `data:${mime};base64,${buffer.toString('base64')}`;
const textFile = body => asDataUrl('text/plain', Buffer.from(body, 'utf8'));

// --------------------------------------------------------------- classify ---

test('recognises files by mime type', () => {
  assert.equal(classify('x', 'application/pdf'), 'pdf');
  assert.equal(classify('x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'docx');
  assert.equal(classify('x', 'text/csv'), 'text');
  assert.equal(classify('x', 'image/jpeg'), 'image');
});

test('falls back to the extension when the browser sends no mime type', () => {
  // Windows regularly reports an empty type for .docx dragged out of Explorer.
  assert.equal(classify('syllabus.docx', ''), 'docx');
  assert.equal(classify('TIMETABLE.PDF', ''), 'pdf');
  assert.equal(classify('notes.TXT', ''), 'text');
  assert.equal(classify('scan.JPEG', ''), 'image');
  assert.equal(classify('archive.zip', ''), 'unknown');
});

test('a mime type with a charset still classifies', () => {
  assert.equal(classify('a.txt', 'text/plain; charset=utf-8'), 'text');
});

// ------------------------------------------------------------- data urls ----

test('decodes base64 and plain data urls', () => {
  assert.equal(decodeDataUrl('data:text/plain;base64,aGVsbG8=').buffer.toString(), 'hello');
  assert.equal(decodeDataUrl('data:text/plain,hello%20there').buffer.toString(), 'hello there');
  assert.equal(decodeDataUrl('data:application/pdf;base64,aGk=').mimeType, 'application/pdf');
});

// ----------------------------------------------------------------- tidy -----

test('tidy keeps line structure but removes Word artefacts', () => {
  const messy = 'Unit 1  Introduction   \r\n\r\n\r\n\r\n  Topic  \r\n';
  const out = tidy(messy);
  assert.ok(out.startsWith('Unit 1  Introduction'), out);
  assert.ok(!/\n{3,}/.test(out), 'blank runs should collapse');
  assert.ok(!/[ \t]$/m.test(out), 'no trailing spaces');
});

test('tidy does not join separate rows', () => {
  const out = tidy('12/09/2026 Maths\n14/09/2026 Physics');
  assert.equal(out.split('\n').length, 2);
});

// ------------------------------------------------------------- rejections ---

test('a photo is refused with advice, not an empty result', async () => {
  await assert.rejects(
    () => extractText({ dataUrl: asDataUrl('image/png', Buffer.from('not really a png')), filename: 'board.png' }),
    err => {
      assert.equal(err.status, 400);
      assert.match(err.message, /photo/i);
      assert.match(err.message, /paste/i, 'should point at the way that does work');
      return true;
    }
  );
});

test('an unsupported type names what is supported', async () => {
  await assert.rejects(
    () => extractText({ dataUrl: asDataUrl('application/zip', Buffer.from('PK')), filename: 'stuff.zip' }),
    /PDF, Word and plain text/
  );
});

test('an empty file is refused', async () => {
  await assert.rejects(
    () => extractText({ dataUrl: 'data:text/plain;base64,', filename: 'empty.txt' }),
    /empty/i
  );
});

test('an oversized file is refused before anything tries to parse it', async () => {
  const big = Buffer.alloc(9 * 1024 * 1024, 0x41);
  await assert.rejects(
    () => extractText({ dataUrl: asDataUrl('application/pdf', big), filename: 'huge.pdf' }),
    /9\.0 MB.*limit is 8 MB/s
  );
});

test('a damaged PDF explains itself instead of throwing a stack trace', async () => {
  await assert.rejects(
    () => extractText({ dataUrl: asDataUrl('application/pdf', Buffer.from('%PDF-1.4 nonsense')), filename: 'broken.pdf' }),
    err => {
      assert.equal(err.status, 400);
      assert.match(err.message, /could not be read/);
      return true;
    }
  );
});

// ------------------------------------------------------------- happy path ---

test('a text timetable comes out ready for the parser', async () => {
  const result = await extractText({
    dataUrl: textFile('Date  Subject  Time\n12/11/2026  CS301 Database Systems  10:00 am\n14 Nov 2026  CS302 Operating Systems  2:00 pm\n'),
    filename: 'timetable.txt',
  });
  assert.equal(result.kind, 'text');
  assert.ok(!result.warning);

  const { rows } = parseTimetable(result.text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.date), ['2026-11-12', '2026-11-14']);
  assert.deepEqual(rows.map(r => r.courseCode), ['CS301', 'CS302']);
  assert.equal(rows[1].time, '14:00');
});

test('a text syllabus comes out ready for the parser', async () => {
  const result = await extractText({
    dataUrl: textFile('Unit 1: Introduction\n- Database concepts\n- ER modelling\nUnit 2 - Normalization\n- Functional dependencies\n'),
    filename: 'syllabus.txt',
  });
  const parsed = parseSyllabus(result.text);
  assert.equal(parsed.units.length, 2);
  assert.ok(parsed.topics.length >= 3, `expected topics, got ${parsed.topics.length}`);
});

test('a nearly empty file is flagged rather than passed on silently', async () => {
  const result = await extractText({ dataUrl: textFile('hi'), filename: 'tiny.txt' });
  assert.match(result.warning, /almost no text/);
});

// A minimal single-page PDF, written by hand so the test needs no fixtures and
// no PDF library to produce one. This is the shape pdfjs actually has to read.
function tinyPdf(lines) {
  const content = lines
    .map((line, i) => `BT /F1 11 Tf 60 ${760 - i * 20} Td (${line.replace(/([()\\])/g, '\\$1')}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('a real PDF is read back as rows the timetable parser understands', async () => {
  const pdf = tinyPdf([
    'END SEMESTER EXAMINATION TIMETABLE',
    '12/11/2026 CS301 Database Management Systems 10:00 am',
    '14/11/2026 CS302 Operating Systems 10:00 am',
    '17 Nov 2026 CS303 Computer Networks 02:00 pm',
  ]);

  const result = await extractText({ dataUrl: asDataUrl('application/pdf', pdf), filename: 'timetable.pdf' });
  assert.equal(result.kind, 'pdf');
  assert.equal(result.pages, 1);

  // Each drawing operation was on its own baseline, so each must come back as
  // its own line — this is the bug that turns a whole timetable into one row.
  assert.equal(result.text.split('\n').length, 4, result.text);

  const { rows } = parseTimetable(result.text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.date), ['2026-11-12', '2026-11-14', '2026-11-17']);
  assert.deepEqual(rows.map(r => r.courseCode), ['CS301', 'CS302', 'CS303']);
  assert.equal(rows[2].time, '14:00');
});

test('a PDF with no text layer is called out as a scan', async () => {
  const result = await extractText({ dataUrl: asDataUrl('application/pdf', tinyPdf([''])), filename: 'scan.pdf' });
  assert.match(result.warning, /scan|no text/i);
});

// A .docx is a zip of XML. Building one by hand keeps the test honest about
// what mammoth is actually handed.
function tinyDocx(paragraphs) {
  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('') +
      '</w:body></w:document>',
  };
  return zipStore(files);
}

/** Minimal stored (uncompressed) zip writer — enough for a .docx. */
function zipStore(files) {
  const entries = [];
  const chunks = [];
  let offset = 0;

  for (const [name, body] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(body, 'utf8');
    const crc = zlib.crc32
      ? zlib.crc32(data)
      : require('node:zlib').crc32?.(data) ?? crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    chunks.push(local, nameBuf, data);
    entries.push({ nameBuf, crc, size: data.length, offset });
    offset += local.length + nameBuf.length + data.length;
  }

  const central = [];
  for (const e of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(e.crc >>> 0, 16);
    header.writeUInt32LE(e.size, 20);
    header.writeUInt32LE(e.size, 24);
    header.writeUInt16LE(e.nameBuf.length, 28);
    header.writeUInt32LE(e.offset, 42);
    central.push(header, e.nameBuf);
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, end]);
}

// Fallback for Node versions without zlib.crc32.
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

test('a real .docx syllabus is read back into units and topics', async () => {
  const docx = tinyDocx([
    'Unit 1: Introduction to Databases',
    'Data models and schema',
    'Relational algebra',
    'Unit 2 - Normalization',
    'Functional dependencies',
    'BCNF',
  ]);

  const result = await extractText({
    dataUrl: asDataUrl('application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx),
    filename: 'syllabus.docx',
  });
  assert.equal(result.kind, 'docx');

  const parsed = parseSyllabus(result.text);
  assert.equal(parsed.units.length, 2, JSON.stringify(parsed.units));
  const titles = parsed.topics.map(t => t.title);
  assert.ok(titles.includes('Relational algebra'), titles.join(' | '));
  assert.ok(titles.includes('BCNF'), titles.join(' | '));
});

// ------------------------------------------------------- wiring, not logic ---

test('the upload middleware is mounted on both preview endpoints', () => {
  // A route that forgets uploadText() still works for pasted text, so nothing
  // fails until someone drops a PDF on it. Cheap to check here.
  for (const file of ['exams.js', 'syllabus.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8');
    const preview = source.match(/router\.post\('\/preview'[^\n]*/)[0];
    assert.match(preview, /uploadText\(\)/, `${file} preview should accept uploads`);
    assert.ok(
      preview.indexOf('uploadText()') < preview.indexOf('validate('),
      `${file}: uploadText must run before validate, or the text it extracts is never checked`
    );
  }
});
