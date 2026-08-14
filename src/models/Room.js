// Group study rooms. Members and the Jitsi room name are per-room data with no
// relational queries, so they live alongside the messages in MongoDB.
const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    topic: { type: String, default: '', maxlength: 200 },
    courseId: { type: Number, default: null, index: true }, // FK -> MySQL courses.id
    hostId: { type: Number, required: true },
    hostName: { type: String, required: true },
    members: { type: [Number], default: [] },               // MySQL user ids
    // Namespaced so two rooms can never collide on the public Jitsi instance
    videoRoom: { type: String, required: true, unique: true },
    scheduledFor: { type: Date, default: null },
    closed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Room', roomSchema);
