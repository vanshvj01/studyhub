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

    // Set when a note was imported rather than written here, so a re-import
    // updates instead of duplicating.
    // 'note' is something a student wrote; 'announcement' and 'material' come
    // from Classroom and are labelled as such rather than passed off as notes.
    kind: { type: String, enum: ['note', 'announcement', 'material'], default: 'note', index: true },

    // Files and links attached in Classroom. Stored as URLs, not copies — one
    // click opens the original in Drive, YouTube or wherever it lives.
    links: {
      type: [{
        title: { type: String, required: true },
        url: { type: String, required: true },
        type: { type: String, default: 'link' },   // drive | link | youtube | form
        _id: false,
      }],
      default: [],
    },

    // Set when imported data is hidden after disconnecting the source.
    archivedAt: { type: Date, default: null, index: true },

    sharedFrom: {
      source: { type: String, default: null },     // 'classroom'
      sourceId: { type: String, default: null, index: true },
      url: { type: String, default: null },
    },
  },
  { timestamps: true }
);

noteSchema.index({ title: 'text', content: 'text' });

module.exports = mongoose.model('Note', noteSchema);
