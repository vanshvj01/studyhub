// Serves uploaded files (note attachments and avatars) back out of MongoDB.
const express = require('express');
const Attachment = require('../models/Attachment');
const { toBuffer } = require('../lib/binary');
const { logger } = require('../lib/logger');

const router = express.Router();

// GET /api/files/:id — public by design: the ids are unguessable and the files
// are class material shared inside the platform.
router.get('/:id', async (req, res, next) => {
  try {
    // No .lean() here: Mongoose casts the stored bytes back to a real Buffer.
    const file = await Attachment.findById(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const data = toBuffer(file.data);
    if (!data) {
      logger.error('stored file could not be read as bytes', { id: req.params.id });
      return res.status(500).json({ error: 'File could not be read' });
    }

    res.set('Content-Type', file.type);
    res.set('Content-Length', String(data.length));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    const inline = file.type.startsWith('image/') || file.type === 'application/pdf';
    res.set('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`);
    res.end(data);   // end(), not send(): never let Express reinterpret the body
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'File not found' });
    next(err);
  }
});

module.exports = router;
