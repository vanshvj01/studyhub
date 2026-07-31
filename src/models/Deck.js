// Flashcard decks live in MongoDB — cards are a natural nested/variable-length
// document, which is exactly what a relational table handles badly.
const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema(
  {
    front: { type: String, required: true, trim: true },
    back: { type: String, required: true, trim: true },
    // Leitner spaced-repetition box: 1 = review often, 5 = well known
    box: { type: Number, default: 1, min: 1, max: 5 },
    lastReviewed: { type: Date, default: null },
  },
  { _id: true }
);

const deckSchema = new mongoose.Schema(
  {
    courseId: { type: Number, required: true, index: true }, // FK -> MySQL courses.id
    ownerId: { type: Number, required: true, index: true },  // FK -> MySQL users.id
    ownerName: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 300 },
    cards: { type: [cardSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Deck', deckSchema);
