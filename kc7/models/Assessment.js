// Assessment model
// One document per screening session.
// Connection note: mongoose model only; DB connection comes from db.js.
const mongoose = require('mongoose');

const assessmentSchema = new mongoose.Schema(
  {
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'complete'],
      default: 'in_progress',
      index: true,
    },
    currentProgress: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    diagnosis: { type: String, default: null },
    recommendations: { type: String, default: null },
  },
  { timestamps: true, collection: 'assessments' }
);

module.exports = mongoose.models.Assessment || mongoose.model('Assessment', assessmentSchema);
