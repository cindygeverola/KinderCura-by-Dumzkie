// Recommendation model
// Stores generated advice based on the latest assessment result.
// Connection note: recommendation model uses the shared mongoose connection from db.js.
const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema(
  {
    assessmentResultId: { type: mongoose.Schema.Types.ObjectId, ref: 'AssessmentResult', required: true, index: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    skill: { type: String, required: true, trim: true },
    priority: { type: String, enum: ['high', 'medium', 'low'], required: true },
    suggestion: { type: String, required: true },
    activities: [{ type: String }],
    consultationNeeded: { type: Boolean, default: false },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: 'recommendations' }
);

module.exports = mongoose.models.Recommendation || mongoose.model('Recommendation', recommendationSchema);
