// Socket.IO layer. HTTP still owns history and room management; sockets only
// carry live traffic: new messages, typing indicators and presence.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { logger } = require('./lib/logger');
const { parseCookies, COOKIE_NAME } = require('./lib/cookies');
const { createMessage } = require('./routes/chat');
const Message = require('./models/Message');
const Room = require('./models/Room');

const online = new Set();

function attachRealtime(httpServer, app, corsOrigin = '*') {
  const io = new Server(httpServer, { cors: { origin: corsOrigin } });

  // Same JWT as the REST API — a socket is not a way around authentication.
  io.use((socket, next) => {
    // Same session as the REST API: explicit token first, cookie otherwise.
    const token = socket.handshake.auth?.token
      || parseCookies(socket.handshake.headers?.cookie)[COOKIE_NAME];
    if (!token) return next(new Error('Missing token'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if ((payload.role || 'student') !== 'student') return next(new Error('Students only'));
      socket.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', socket => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);
    online.add(userId);
    io.emit('presence', [...online]);
    logger.debug('socket connected', { user: userId });

    socket.on('dm:send', async (payload, ack) => {
      try {
        const otherId = Number(payload?.toUserId);
        if (!Number.isInteger(otherId) || otherId === userId) throw new Error('Invalid recipient');
        const message = await createMessage({
          senderId: userId,
          conversationId: Message.dmKey(userId, otherId),
          body: payload.body,
          noteId: payload.noteId,
        });
        io.to(`user:${otherId}`).emit('message', message);
        socket.emit('message', message);
        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('room:join', async (roomId, ack) => {
      try {
        const room = await Room.findByIdAndUpdate(roomId, { $addToSet: { members: userId } });
        if (!room) throw new Error('Room not found');
        socket.join(`room:${roomId}`);
        socket.to(`room:${roomId}`).emit('room:joined', { roomId, userId });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('room:leave', roomId => socket.leave(`room:${roomId}`));

    socket.on('room:send', async (payload, ack) => {
      try {
        const message = await createMessage({
          senderId: userId,
          roomId: String(payload?.roomId),
          body: payload?.body,
          noteId: payload?.noteId,
        });
        io.to(`room:${payload.roomId}`).emit('message', message);
        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('typing', ({ toUserId, roomId, isTyping }) => {
      const target = roomId ? `room:${roomId}` : `user:${toUserId}`;
      socket.to(target).emit('typing', { from: userId, roomId, isTyping: !!isTyping });
    });

    socket.on('disconnect', () => {
      // only drop presence when the user's last tab closes
      if (io.sockets.adapter.rooms.get(`user:${userId}`)?.size === undefined) {
        online.delete(userId);
        io.emit('presence', [...online]);
      }
      logger.debug('socket disconnected', { user: userId });
    });
  });

  app.set('io', io);
  return io;
}

module.exports = { attachRealtime };
