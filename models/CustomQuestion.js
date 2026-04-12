// CustomQuestion model
// Stores each pediatrician-made question in MongoDB.
// The numeric `id` field is used by the frontend for easy edit/delete actions.

const mongoose = require('mongoose');
const Counter = require('./Counter');

// Schema definition for one custom question
const customQuestionSchema = new mongoose.Schema(
  {
    // Numeric id is kept so existing pediatrician pages can keep using q.id in onclick handlers.
    id: { type: Number, unique: true, index: true },
    pediatricianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questionText: { type: String, required: true, trim: true },
    questionType: {
      type: String,
      enum: ['yes_no', 'multiple_choice', 'short_answer'],
      required: true,
    },
    options: { type: [String], default: [] },
    domain: { type: String, trim: true, default: 'Other' },
    ageMin: { type: Number, default: 0 },
    ageMax: { type: Number, default: 18 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'customquestions' }
);

customQuestionSchema.pre('validate', async function (next) {
  if (!this.isNew || this.id != null) return next();
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'custom_questions' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    this.id = counter.seq;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.models.CustomQuestion || mongoose.model('CustomQuestion', customQuestionSchema);
