// Uploaded files live in MongoDB rather than on local disk: hosting platforms
// give containers an ephemeral filesystem, so anything written to disk vanishes
// on the next deploy. Storing the bytes in the database keeps them.
const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, required: true },   // mime type
    size: { type: Number, required: true },   // bytes
    data: { type: Buffer, required: true },
    ownerId: { type: Number, required: true, index: true }, // FK -> MySQL users.id
  },
  { timestamps: true }
);

module.exports = mongoose.model('Attachment', attachmentSchema);
