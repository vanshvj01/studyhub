// Lets any endpoint that already accepts pasted text also accept an uploaded
// file, without the handler knowing which one arrived.
//
// If the request carries `file: { dataUrl, name, type }`, the text is extracted
// from it and put into `req.body.text` — so validate() and the parser that
// follows behave exactly as they do for a paste. `req.upload` carries the
// details the response needs (filename, page count, any warning).
const { extractText } = require('../lib/extract');

function uploadText() {
  return async (req, res, next) => {
    const file = req.body?.file;
    if (!file || !file.dataUrl) return next();

    try {
      const result = await extractText({
        dataUrl: file.dataUrl,
        filename: file.name || file.filename || '',
        mimeType: file.type || file.mimeType || '',
      });
      req.body.text = result.text;
      req.upload = {
        filename: result.filename,
        kind: result.kind,
        bytes: result.bytes,
        pages: result.pages,
        warning: result.warning,
        chars: result.text.length,
      };
      // A file that yields nothing usable stops here with a readable reason,
      // rather than reaching the parser and coming back as "0 rows found".
      if (result.warning && result.text.length < 20) {
        return res.status(422).json({ error: result.warning, filename: result.filename });
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { uploadText };
