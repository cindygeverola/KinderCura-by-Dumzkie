// AssessmentResult model
// Stores the calculated scores after a screening is submitted.
// Connection note: this collection is used after screening submission calculates scores.
const mongoose = require('mongoose');

const assessmentResultSchema = new mongoose.Schema(
  {
    assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true, unique: true, index: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    communicationScore: { type: Number, default: 0 },
    socialScore: { type: Number, default: 0 },
    cognitiveScore: { type: Number, default: 0 },
    motorScore: { type: Number, default: 0 },
    overallScore: { type: Number, default: 0 },
    communicationStatus: { type: String, default: null },
    socialStatus: { type: String, default: null },
    cognitiveStatus: { type: String, default: null },
    motorStatus: { type: String, default: null },
    riskFlags: [{ type: String }],
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: 'results' }
);

module.exports = mongoose.models.AssessmentResult || mongoose.model('AssessmentResult', assessmentResultSchema);
