// Serves uploaded files back out of MongoDB.
const express = require('express');
const Attachment = require('../models/Attachment');

const router = express.Router();

// GET /api/files/:id — public by design: URLs are unguessable ObjectIds and the
// files are class notes shared inside the platform.
router.get('/:id', async (req, res, next) => {
  try {
    const file = await Attachment.findById(req.params.id).lean();
    if (!file) return res.status(404).json({ error: 'File not found' });

    res.set('Content-Type', file.type);
    res.set('Content-Length', String(file.size));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    // inline for things a browser can display, download for everything else
    const inline = file.type.startsWith('image/') || file.type === 'application/pdf';
    res.set('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`);
    res.send(file.data);
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'File not found' });
    next(err);
  }
});

module.exports = router;
