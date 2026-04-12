// OTP model
// Stores temporary email verification codes before registration finishes
const mongoose = require('mongoose');

const otpCodeSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, trim: true, lowercase: true, index: true },
        code: { type: String, required: true, trim: true },
        expiresAt: { type: Date, required: true },
        used: { type: Boolean, default: false },
    },
    // Only keep createdAt because OTP rows do not need updatedAt
    { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.models.OtpCode || mongoose.model('OtpCode', otpCodeSchema);
