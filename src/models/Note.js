// Notes live in MongoDB: free-form markdown content, flexible tags and a
// variable-length attachment list, all referencing MySQL rows by integer id.
const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },   // /uploads/<file>
    type: { type: String, default: '' },     // mime type
    size: { type: Number, default: 0 },      // bytes
  },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  {
    courseId: { type: Number, required: true, index: true }, // FK -> MySQL courses.id
    authorId: { type: Number, required: true, index: true }, // FK -> MySQL users.id
    authorName: { type: String, required: true },            // denormalized for display
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, required: true },               // markdown / free text
    tags: { type: [String], default: [], index: true },
    upvotes: { type: [Number], default: [] },                // user ids that upvoted
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: true }
);

noteSchema.index({ title: 'text', content: 'text' });

module.exports = mongoose.model('Note', noteSchema);
