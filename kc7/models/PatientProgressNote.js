// PatientProgressNote model
// Stores pediatrician follow-up notes so progress can be tracked over time per child.
const mongoose = require('mongoose');
const Counter = require('./Counter');

const patientProgressNoteSchema = new mongoose.Schema(
  {
    // Simple numeric id keeps the frontend and exports easier to read.
    id: { type: Number, unique: true, index: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    pediatricianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    appointmentId: { type: Number, default: null, index: true },
    assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', default: null, index: true },
    progressStatus: {
      type: String,
      enum: ['initial_review', 'monitoring', 'follow_up', 'improving', 'stable', 'needs_attention', 'referred', 'completed'],
      default: 'monitoring',
      index: true,
    },
    note: { type: String, required: true, trim: true },
  },
  { timestamps: true, collection: 'patient_progress_notes' }
);

patientProgressNoteSchema.pre('validate', async function (next) {
  if (!this.isNew || this.id != null) return next();
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'patient_progress_notes' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    this.id = counter.seq;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.models.PatientProgressNote || mongoose.model('PatientProgressNote', patientProgressNoteSchema);
