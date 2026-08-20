// Turns an uploaded timetable or syllabus into plain text so the existing
// parsers (lib/timetable.js, lib/syllabus.js) can read it.
//
// The upload arrives as a base64 data URL, the same way note attachments and
// avatars already do, so nothing new is needed on the request side.
//
// What is deliberately NOT here: OCR. A photograph of a notice board needs
// tesseract, which is a 30 MB download and slow on a small instance. When
// someone uploads an image we say so plainly and point them at the paste box,
// rather than returning an empty document and letting them wonder why.

const MAX_BYTES = 8 * 1024 * 1024;   // 8 MB — larger than any real timetable

const KIND = {
  pdf: ['application/pdf'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ],
  text: ['text/plain', 'text/csv', 'text/markdown', 'application/csv', 'text/tab-separated-values'],
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/gif'],
};

const EXTENSIONS = {
  pdf: 'pdf', docx: 'docx', doc: 'docx',
  txt: 'text', csv: 'text', tsv: 'text', md: 'text', rtf: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', heic: 'image', gif: 'image',
};

/** Works out what a file is from its mime type, falling back to the extension. */
function classify(filename = '', mimeType = '') {
  const mime = String(mimeType).split(';')[0].trim().toLowerCase();
  for (const [kind, types] of Object.entries(KIND)) {
    if (types.includes(mime)) return kind;
  }
  const ext = String(filename).split('.').pop()?.toLowerCase();
  return EXTENSIONS[ext] || 'unknown';
}

/** Splits `data:<mime>;base64,<payload>` — or accepts bare base64. */
function decodeDataUrl(dataUrl) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!match) return { mimeType: '', buffer: Buffer.from(raw, 'base64') };
  const [, mimeType, isBase64, payload] = match;
  return {
    mimeType,
    buffer: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8'),
  };
}

/**
 * PDF text comes out with the layout flattened, so a table row can arrive as
 * several lines or as one long line. Both parsers work line by line, so this
 * tidies the whitespace without joining rows that were genuinely separate.
 */
function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')            // non-breaking spaces from Word
    .replace(/[ \t]{2,}/g, '  ')        // keep a gap as a column hint, drop the rest
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .filter((line, i, all) => line.trim() !== '' || all[i - 1]?.trim() !== '')  // collapse blank runs
    .join('\n')
    .trim();
}

/**
 * PDF text is a bag of positioned fragments, not lines. A timetable row like
 *
 *     12/11/2026   CS301 Database Management Systems   10:00 am
 *
 * arrives as three separate items that happen to share a y coordinate. Naive
 * extractors concatenate in reading order and lose the row boundaries, which
 * turns a whole timetable into one unparseable line — so fragments are grouped
 * by baseline and sorted left to right, rebuilding the rows the student sees.
 */
async function fromPdf(buffer) {
  // The legacy build is the one that runs under Node without a DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,     // never let a PDF run generated code on the server
    disableFontFace: true,
  }).promise;

  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    const rows = new Map();
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const x = item.transform[4];
      const y = Math.round(item.transform[5] / 3);   // ~3pt tolerance for baseline wobble
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str: item.str });
    }

    for (const y of [...rows.keys()].sort((a, b) => b - a)) {       // top of page first
      const parts = rows.get(y).sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = null;
      for (const part of parts) {
        // A wide horizontal gap is a column break, not a space.
        if (prevEnd !== null && part.x - prevEnd > 6 && !/\s$/.test(line)) line += '  ';
        line += part.str;
        prevEnd = part.x + part.str.length * 4.5;                   // rough advance width
      }
      if (line.trim()) lines.push(line.trim());
    }
    page.cleanup();
  }
  await doc.destroy();
  return { text: tidy(lines.join('\n')), pages: doc.numPages };
}

async function fromDocx(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: tidy(result.value) };
}

function fromText(buffer) {
  return { text: tidy(buffer.toString('utf8')) };
}

/**
 * @param {{ dataUrl: string, filename?: string, mimeType?: string }} file
 * @returns {Promise<{ text, kind, filename, bytes, pages?, warning? }>}
 * @throws  Error with .status set, so routes can pass it straight to next()
 */
async function extractText({ dataUrl, filename = '', mimeType = '' }) {
  const decoded = decodeDataUrl(dataUrl);
  const buffer = decoded.buffer;
  const bad = message => Object.assign(new Error(message), { status: 400 });

  if (!buffer?.length) throw bad('That file came through empty. Try uploading it again.');
  if (buffer.length > MAX_BYTES) {
    throw bad(`That file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. The limit is 8 MB.`);
  }

  const kind = classify(filename, mimeType || decoded.mimeType);

  if (kind === 'image') {
    throw bad('This is a photo, and StudyHub cannot read text out of images yet. Open the timetable on a computer and upload the PDF, or copy the text into the paste box.');
  }
  if (kind === 'unknown') {
    throw bad(`StudyHub can read PDF, Word and plain text files. ${filename ? `"${filename}"` : 'That file'} is none of those.`);
  }

  let result;
  try {
    if (kind === 'pdf') result = await fromPdf(buffer);
    else if (kind === 'docx') result = await fromDocx(buffer);
    else result = fromText(buffer);
  } catch (err) {
    throw bad(`That ${kind === 'pdf' ? 'PDF' : 'file'} could not be read — it may be password protected or damaged. You can paste the text instead.`);
  }

  const out = { ...result, kind, filename, bytes: buffer.length };

  // A scanned timetable is a PDF full of images with no text layer. It extracts
  // cleanly and yields nothing, which looks like a bug unless we name it.
  if (!out.text || out.text.length < 20) {
    out.warning = kind === 'pdf'
      ? 'This PDF has no text in it — it is probably a scan or a photo saved as a PDF. Copy the text in by hand instead.'
      : 'There was almost no text in that file.';
  }
  return out;
}

module.exports = { extractText, classify, decodeDataUrl, tidy, MAX_BYTES };
