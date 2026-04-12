// Appointment model
// Stores parent appointment bookings for pediatricians.
// Connection note: models do not store the connection string.
// They attach to the mongoose connection that db.js already opened.
const mongoose = require('mongoose');
const Counter = require('./Counter');

const appointmentSchema = new mongoose.Schema(
  {
    // Numeric id kept because several existing HTML pages use ids directly in onclick.
    id: { type: Number, unique: true, index: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pediatricianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    appointmentDate: { type: Date, required: true },
    // Keep time as a simple HH:mm or browser time string so frontend formatting stays easy.
    appointmentTime: { type: String, required: true },
    reason: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    location: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'completed', 'cancelled', 'rejected'],
      default: 'pending',
      index: true,
    },
    hasVideo: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'appointments' }
);

appointmentSchema.pre('validate', async function (next) {
  if (!this.isNew || this.id != null) return next();
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'appointments' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    this.id = counter.seq;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
