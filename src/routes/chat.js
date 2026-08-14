// Direct messages, group study rooms and note sharing.
// Sockets deliver messages live; these endpoints load history and manage rooms.
const express = require('express');
const crypto = require('crypto');
const Message = require('../models/Message');
const Room = require('../models/Room');
const Note = require('../models/Note');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../lib/validate');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

const publicUser = u => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar });

// GET /api/chat/people?q= — who you can message (everyone on a shared course first)
router.get('/people', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT DISTINCT u.id, u.name, u.username, u.avatar,
              EXISTS(SELECT 1 FROM enrollments e1
                     JOIN enrollments e2 ON e1.course_id = e2.course_id
                     WHERE e1.user_id = u.id AND e2.user_id = ?) AS shares_course
       FROM users u
       WHERE u.id <> ? AND u.role = 'student' AND u.email_verified = 1
         AND (? = '' OR u.name LIKE ? OR u.username LIKE ?)
       ORDER BY shares_course DESC, u.name
       LIMIT 40`,
      [req.user.id, req.user.id, q, like, like]
    );
    res.json(rows.map(r => ({ ...publicUser(r), sharesCourse: !!r.shares_course })));
  } catch (err) { next(err); }
});

// GET /api/chat/conversations — everyone I have talked to, most recent first
router.get('/conversations', async (req, res, next) => {
  try {
    const mine = await Message.find({ conversationId: { $regex: `(^dm:${req.user.id}:|:${req.user.id}$)` } })
      .sort({ createdAt: -1 }).limit(300).lean();

    const seen = new Map();
    for (const m of mine) {
      if (seen.has(m.conversationId)) continue;
      const [, a, b] = m.conversationId.split(':').map(Number);
      const otherId = a === req.user.id ? b : a;
      seen.set(m.conversationId, { otherId, last: m });
    }
    if (seen.size === 0) return res.json([]);

    const ids = [...seen.values()].map(v => v.otherId);
    const [users] = await pool.query(
      'SELECT id, name, username, avatar FROM users WHERE id IN (?)', [ids]
    );
    const byId = Object.fromEntries(users.map(u => [u.id, u]));

    res.json([...seen.values()]
      .filter(v => byId[v.otherId])
      .map(v => ({
        user: publicUser(byId[v.otherId]),
        lastMessage: v.last.body || (v.last.sharedNote ? `Shared a note: ${v.last.sharedNote.title}` : ''),
        lastAt: v.last.createdAt,
        fromMe: v.last.senderId === req.user.id,
      })));
  } catch (err) { next(err); }
});

// GET /api/chat/dm/:userId — conversation history
router.get('/dm/:userId', async (req, res, next) => {
  try {
    const otherId = Number(req.params.userId);
    if (!Number.isInteger(otherId) || otherId === req.user.id) {
      return res.status(400).json({ error: 'Pick someone else to message' });
    }
    const [[other]] = await pool.execute(
      "SELECT id, name, username, avatar FROM users WHERE id = ? AND role = 'student'", [otherId]
    );
    if (!other) return res.status(404).json({ error: 'No such student' });

    const messages = await Message.find({ conversationId: Message.dmKey(req.user.id, otherId) })
      .sort({ createdAt: 1 }).limit(200).lean();
    res.json({ user: publicUser(other), messages });
  } catch (err) { next(err); }
});

// POST /api/chat/dm/:userId { body?, noteId? } — REST fallback; sockets are the fast path
router.post('/dm/:userId', validate({
  body: { type: 'string', maxLen: 2000 },
  noteId: { type: 'string', maxLen: 40 },
}), async (req, res, next) => {
  try {
    const otherId = Number(req.params.userId);
    const message = await createMessage({
      senderId: req.user.id,
      conversationId: Message.dmKey(req.user.id, otherId),
      body: req.body.body,
      noteId: req.body.noteId,
    });
    req.app.get('io')?.to(`user:${otherId}`).emit('message', message);
    res.status(201).json(message);
  } catch (err) { next(err); }
});

/** Shared by the REST routes and the socket handlers. */
async function createMessage({ senderId, conversationId, roomId, body, noteId }) {
  const text = String(body || '').trim();
  if (!text && !noteId) {
    const err = new Error('Message cannot be empty');
    err.status = 400;
    throw err;
  }

  const [[sender]] = await pool.execute('SELECT name FROM users WHERE id = ?', [senderId]);

  let sharedNote;
  if (noteId) {
    const note = await Note.findById(noteId).select('title courseId').lean();
    if (!note) {
      const err = new Error('That note no longer exists');
      err.status = 404;
      throw err;
    }
    sharedNote = { noteId: String(note._id), title: note.title, courseId: note.courseId };
  }

  const doc = await Message.create({
    conversationId, roomId,
    senderId, senderName: sender?.name || 'Unknown',
    body: text.slice(0, 2000), sharedNote,
  });
  return doc.toObject();
}

// ---------------------------------------------------------------- study rooms

// GET /api/rooms — open rooms, mine first
router.get('/rooms', async (req, res, next) => {
  try {
    const rooms = await Room.find({ closed: false }).sort({ updatedAt: -1 }).limit(50).lean();
    res.json(rooms.map(r => ({
      ...r,
      memberCount: r.members.length,
      isMember: r.members.includes(req.user.id),
      isHost: r.hostId === req.user.id,
    })));
  } catch (err) { next(err); }
});

// POST /api/rooms { title, topic?, courseId?, scheduledFor? }
router.post('/rooms', validate({
  title: { type: 'string', required: true, maxLen: 120 },
  topic: { type: 'string', maxLen: 200 },
  courseId: { type: 'int' },
  scheduledFor: { type: 'string', maxLen: 40 },
}), async (req, res, next) => {
  try {
    const { title, topic, courseId, scheduledFor } = req.body;
    if (courseId) {
      const [rows] = await pool.execute('SELECT 1 FROM courses WHERE id = ?', [courseId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    }
    const [[me]] = await pool.execute('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const room = await Room.create({
      title, topic: topic || '', courseId: courseId ?? null,
      hostId: req.user.id, hostName: me?.name || 'Unknown',
      members: [req.user.id],
      videoRoom: `studyhub-${crypto.randomBytes(8).toString('hex')}`,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    });
    res.status(201).json(room);
  } catch (err) { next(err); }
});

// GET /api/rooms/:id — room plus recent messages
router.get('/rooms/:id', async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id).lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const messages = await Message.find({ roomId: String(room._id) })
      .sort({ createdAt: 1 }).limit(200).lean();

    let members = [];
    if (room.members.length) {
      const [rows] = await pool.query(
        'SELECT id, name, username, avatar FROM users WHERE id IN (?)', [room.members]
      );
      members = rows.map(publicUser);
    }
    res.json({ ...room, members, messages, isMember: room.members.includes(req.user.id) });
  } catch (err) { next(err); }
});

// POST /api/rooms/:id/join
router.post('/rooms/:id/join', async (req, res, next) => {
  try {
    const room = await Room.findByIdAndUpdate(
      req.params.id, { $addToSet: { members: req.user.id } }, { new: true }
    ).lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ message: 'Joined', memberCount: room.members.length });
  } catch (err) { next(err); }
});

// POST /api/rooms/:id/messages { body?, noteId? }
router.post('/rooms/:id/messages', validate({
  body: { type: 'string', maxLen: 2000 },
  noteId: { type: 'string', maxLen: 40 },
}), async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const message = await createMessage({
      senderId: req.user.id, roomId: String(room._id),
      body: req.body.body, noteId: req.body.noteId,
    });
    req.app.get('io')?.to(`room:${room._id}`).emit('message', message);
    res.status(201).json(message);
  } catch (err) { next(err); }
});

// DELETE /api/rooms/:id — host closes the room
router.delete('/rooms/:id', async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.hostId !== req.user.id) return res.status(403).json({ error: 'Only the host can close this room' });
    room.closed = true;
    await room.save();
    res.json({ message: 'Room closed' });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.createMessage = createMessage;
