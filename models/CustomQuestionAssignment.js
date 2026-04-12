// CustomQuestionAssignment model
// Stores which question was assigned to which child/parent and the parent's answer if available.

const mongoose = require('mongoose');
const Counter = require('./Counter');

// Schema definition for one question assignment
const customQuestionAssignmentSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true, index: true },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomQuestion', required: true, index: true },
    appointmentId: { type: Number, default: null, index: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    answer: { type: String, default: null },
    answeredAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'customquestionassignments' }
);

customQuestionAssignmentSchema.pre('validate', async function (next) {
  if (!this.isNew || this.id != null) return next();
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'custom_question_assignments' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    this.id = counter.seq;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.models.CustomQuestionAssignment || mongoose.model('CustomQuestionAssignment', customQuestionAssignmentSchema);
