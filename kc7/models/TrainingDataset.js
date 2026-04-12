// TrainingDataset model
// Stores uploaded dataset files and simple training status for the admin page.
const mongoose = require('mongoose');

const trainingDatasetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    storedName: { type: String, required: true, trim: true },
    filePath: { type: String, required: true, trim: true },
    fileType: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true },
    rowCount: { type: Number, default: 0 },
    columnCount: { type: Number, default: 0 },
    sampleColumns: [{ type: String }],
    targetModule: {
      type: String,
      enum: ['assessment', 'recommendation', 'general'],
      default: 'general',
    },
    notes: { type: String, default: null },
    status: {
      type: String,
      enum: ['uploaded', 'trained', 'failed'],
      default: 'uploaded',
      index: true,
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    trainedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    trainedAt: { type: Date, default: null },
    trainingSummary: { type: String, default: null },
  },
  { timestamps: true, collection: 'training_datasets' }
);

module.exports = mongoose.models.TrainingDataset || mongoose.model('TrainingDataset', trainingDatasetSchema);
