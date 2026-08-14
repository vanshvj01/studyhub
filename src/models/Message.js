// Chat messages live in MongoDB: high write volume, no relational queries
// needed, and the shape varies (plain text, or a shared note reference).
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    // Exactly one of these is set.
    conversationId: { type: String, index: true },  // "dm:3:7" — always the lower id first
    roomId: { type: String, index: true },          // study room _id

    senderId: { type: Number, required: true },     // FK -> MySQL users.id
    senderName: { type: String, required: true },
    body: { type: String, default: '', maxlength: 2000 },

    // Optional attached note, denormalised so the chat list needs no extra lookup
    sharedNote: {
      noteId: String,
      title: String,
      courseId: Number,
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ roomId: 1, createdAt: -1 });

/** Deterministic conversation key so both participants derive the same id. */
messageSchema.statics.dmKey = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;

module.exports = mongoose.model('Message', messageSchema);
