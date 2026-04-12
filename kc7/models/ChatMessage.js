// ChatMessage model
// Stores messages exchanged between a parent and a pediatrician under an appointment.
// Connection note: chat messages use the same mongoose connection started by server.js.
const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    appointmentId: { type: Number, required: true, index: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pediatricianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['parent', 'pediatrician'], required: true },
    message: { type: String, default: null },
    videoPath: { type: String, default: null },
    videoName: { type: String, default: null },
    videoSize: { type: Number, default: null },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: 'chat_messages' }
);

module.exports = mongoose.models.ChatMessage || mongoose.model('ChatMessage', chatMessageSchema);
