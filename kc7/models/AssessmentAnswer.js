// AssessmentAnswer model
// Stores one answer per question for one assessment.
// Connection note: DB connection string is in .env as MONGODB_URI.
const mongoose = require('mongoose');

const assessmentAnswerSchema = new mongoose.Schema(
  {
    assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    questionId: { type: String, required: true },
    domain: { type: String, required: true, trim: true },
    questionText: { type: String, default: '' },
    answer: { type: String, required: true, trim: true },
  },
  { timestamps: true, collection: 'assessment_answers' }
);

assessmentAnswerSchema.index({ assessmentId: 1, questionId: 1 }, { unique: true });

module.exports = mongoose.models.AssessmentAnswer || mongoose.model('AssessmentAnswer', assessmentAnswerSchema);
