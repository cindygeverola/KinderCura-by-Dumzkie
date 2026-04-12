// models/Notification.js
// Stores in-app notifications for parents, pediatricians, or admins.
// Important:
// - keeps the normal bell data (title, message, type, read state)
// - also stores optional navigation context so a click can open the exact child/result page
const mongoose = require('mongoose');
const Counter = require('./Counter');

const notificationSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, trim: true, default: '' },
    type: { type: String, trim: true, default: 'system' },
    isRead: { type: Boolean, default: false, index: true },

    // Optional context fields used by the frontend when a notification is opened.
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', default: null, index: true },
    assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', default: null, index: true },
    appointmentId: { type: Number, default: null, index: true },
    targetPage: { type: String, trim: true, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' }
);

notificationSchema.pre('validate', async function (next) {
  if (!this.isNew || this.id != null) return next();
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'notifications' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    this.id = counter.seq;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
