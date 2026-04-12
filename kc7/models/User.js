// models/User.js
// Stores all account types and the pediatrician schedule/settings in MongoDB.
const mongoose = require('mongoose');

const availabilitySchema = new mongoose.Schema(
  {
    days: [{ type: String, trim: true }],
    startTime: { type: String, default: '09:00' },
    endTime: { type: String, default: '17:00' },
    maxPatientsPerDay: { type: Number, default: 10 },
  },
  { _id: false }
);

const notificationSettingsSchema = new mongoose.Schema(
  {
    emailAppointments: { type: Boolean, default: true },
    inApp: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    assessmentCompleted: { type: Boolean, default: true },
    dailySummary: { type: Boolean, default: false },
  },
  { _id: false }
);

const privacySettingsSchema = new mongoose.Schema(
  {
    showProfile: { type: Boolean, default: true },
    showAvailability: { type: Boolean, default: true },
    shareRecommendations: { type: Boolean, default: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true, default: null },
    lastName: { type: String, required: true, trim: true },
    username: { type: String, required: true, trim: true, unique: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['parent', 'pediatrician', 'admin'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'suspended'],
      default: 'active',
    },
    emailVerified: { type: Boolean, default: false },
    profileIcon: { type: String, default: 'avatar1' },

    // Pediatrician profile fields
    licenseNumber: { type: String, trim: true, default: null },
    institution: { type: String, trim: true, default: null },
    specialization: { type: String, trim: true, default: null },
    clinicName: { type: String, trim: true, default: null },
    clinicAddress: { type: String, trim: true, default: null },
    phoneNumber: { type: String, trim: true, default: null },
    consultationFee: { type: Number, default: null },
    bio: { type: String, trim: true, default: null },
    availability: { type: availabilitySchema, default: () => ({}) },
    notificationSettings: { type: notificationSettingsSchema, default: () => ({}) },
    privacySettings: { type: privacySettingsSchema, default: () => ({}) },

    // Admin fields
    organization: { type: String, trim: true, default: null },
    department: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
