// Counter model
// Used to generate simple numeric ids for collections that the current frontend
// still expects to be numbers inside onclick handlers.
// Purpose note: keeps simple numeric ids for parts of the old frontend that still expect numbers.
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { collection: 'counters', versionKey: false }
);

module.exports = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
