// Admin routes (MongoDB version)
// Purpose:
// - dashboard counts and admin analytics
// - manage users
// - upload datasets for the admin training page
// - mark a dataset as trained so the admin can track model-preparation work

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { authMiddleware, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const Child = require('../models/Child');
const Assessment = require('../models/Assessment');
const AssessmentResult = require('../models/AssessmentResult');
const Appointment = require('../models/Appointment');
const TrainingDataset = require('../models/TrainingDataset');

function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ensureDatasetDir() {
  const dir = path.join(__dirname, '..', 'public', 'uploads', 'datasets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const datasetStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ensureDatasetDir()),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanBase = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_');
    cb(null, `${Date.now()}_${cleanBase}${ext}`);
  },
});

const datasetUpload = multer({
  storage: datasetStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.json'].includes(ext)) return cb(null, true);
    cb(new Error('Only CSV and JSON datasets are allowed.'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

function parseDatasetFile(fullPath, ext) {
  const raw = fs.readFileSync(fullPath, 'utf8');

  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const first = parsed[0] && typeof parsed[0] === 'object' ? parsed[0] : {};
      const columns = Object.keys(first);
      return {
        rowCount: parsed.length,
        columnCount: columns.length,
        sampleColumns: columns.slice(0, 12),
      };
    }

    if (parsed && typeof parsed === 'object') {
      const columns = Object.keys(parsed);
      return { rowCount: 1, columnCount: columns.length, sampleColumns: columns.slice(0, 12) };
    }

    return { rowCount: 0, columnCount: 0, sampleColumns: [] };
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { rowCount: 0, columnCount: 0, sampleColumns: [] };
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return {
    rowCount: Math.max(lines.length - 1, 0),
    columnCount: headers.length,
    sampleColumns: headers.slice(0, 12),
  };
}

function safeRemoveUpload(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/datasets/')) return;
  const fileName = publicPath.replace('/uploads/datasets/', '');
  const fullPath = path.join(__dirname, '..', 'public', 'uploads', 'datasets', fileName);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

// GET /api/admin/dashboard
router.get('/dashboard', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [
      totalUsers,
      activeAssessments,
      completedScreenings,
      parentCount,
      pediatricianCount,
      adminCount,
      childCount,
      latestUsers,
      latestAppointments,
      latestAssessments,
      trainingDatasetCount,
      trainedDatasetCount,
    ] = await Promise.all([
      User.countDocuments(),
      Assessment.countDocuments({ status: 'in_progress' }),
      Assessment.countDocuments({ status: { $in: ['submitted', 'complete'] } }),
      User.countDocuments({ role: 'parent' }),
      User.countDocuments({ role: 'pediatrician' }),
      User.countDocuments({ role: 'admin' }),
      Child.countDocuments(),
      User.find().sort({ createdAt: -1 }).limit(3).lean(),
      Appointment.find().sort({ createdAt: -1 }).limit(3).lean(),
      Assessment.find().sort({ createdAt: -1 }).limit(3).lean(),
      TrainingDataset.countDocuments(),
      TrainingDataset.countDocuments({ status: 'trained' }),
    ]);

    const recentTraining = await TrainingDataset.find().sort({ updatedAt: -1 }).limit(2).lean();

    const recentActivity = [
      ...latestUsers.map((u) => ({
        when: u.createdAt,
        type: 'User Registered',
        description: `${u.firstName} ${u.lastName} joined as ${u.role}.`,
      })),
      ...latestAppointments.map((a) => ({
        when: a.createdAt,
        type: 'Appointment Booked',
        description: `Appointment #${a.id} was booked with status ${a.status}.`,
      })),
      ...latestAssessments.map((a) => ({
        when: a.createdAt || a.startedAt,
        type: 'Assessment Activity',
        description: `Assessment ${a.status} recorded.`,
      })),
      ...recentTraining.map((d) => ({
        when: d.updatedAt || d.createdAt,
        type: d.status === 'trained' ? 'Dataset Trained' : 'Dataset Uploaded',
        description: `${d.name} (${d.rowCount || 0} rows) is currently marked as ${d.status}.`,
      })),
    ]
      .sort((a, b) => new Date(b.when) - new Date(a.when))
      .slice(0, 6)
      .map((a) => ({ ...a, timestamp: fmtDate(a.when) }));

    res.json({
      success: true,
      totalUsers,
      activeAssessments,
      completedScreenings,
      uptime: '99.9%',
      parentCount,
      pediatricianCount,
      adminCount,
      childCount,
      trainingDatasetCount,
      trainedDatasetCount,
      recentActivity,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { role, status, search = '' } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (search) {
      const rx = new RegExp(search, 'i');
      filter.$or = [
        { firstName: rx },
        { lastName: rx },
        { email: rx },
        { username: rx },
      ];
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      users: users.map((u) => ({
        id: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        email: u.email,
        role: u.role,
        status: u.status,
        createdAt: fmtDate(u.createdAt),
        licenseNumber: u.licenseNumber || null,
        institution: u.institution || null,
        specialization: u.specialization || null,
        organization: u.organization || null,
        department: u.department || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/approve
router.post('/users/approve', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findByIdAndUpdate(userId, { status: 'active' }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, message: 'User approved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/suspend
router.post('/users/suspend', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findByIdAndUpdate(userId, { status: 'suspended' }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, message: 'User suspended.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/analytics
router.get('/analytics', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [results, users, appointments, datasets] = await Promise.all([
      AssessmentResult.find().lean(),
      User.find().select('role createdAt').lean(),
      Appointment.find().select('status').lean(),
      TrainingDataset.find().select('status targetModule rowCount').lean(),
    ]);

    const averageScores = results.length
      ? {
          avgCommunication: results.reduce((s, r) => s + (r.communicationScore || 0), 0) / results.length,
          avgSocial: results.reduce((s, r) => s + (r.socialScore || 0), 0) / results.length,
          avgCognitive: results.reduce((s, r) => s + (r.cognitiveScore || 0), 0) / results.length,
          avgMotor: results.reduce((s, r) => s + (r.motorScore || 0), 0) / results.length,
        }
      : { avgCommunication: null, avgSocial: null, avgCognitive: null, avgMotor: null };

    const now = new Date();
    const monthlySignups = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = users.filter((u) => new Date(u.createdAt) >= d && new Date(u.createdAt) < next).length;
      monthlySignups.push({ month: d.toLocaleDateString('en-US', { month: 'short' }), count });
    }

    const apptMap = new Map();
    appointments.forEach((a) => apptMap.set(a.status, (apptMap.get(a.status) || 0) + 1));
    const appointmentStats = Array.from(apptMap.entries()).map(([status, count]) => ({ status, count }));

    const roleMap = new Map();
    users.forEach((u) => roleMap.set(u.role, (roleMap.get(u.role) || 0) + 1));
    const roleBreakdown = Array.from(roleMap.entries()).map(([role, count]) => ({ role, count }));

    const datasetStatusMap = new Map();
    datasets.forEach((d) => datasetStatusMap.set(d.status, (datasetStatusMap.get(d.status) || 0) + 1));
    const datasetStats = Array.from(datasetStatusMap.entries()).map(([status, count]) => ({ status, count }));

    res.json({ success: true, averageScores, monthlySignups, appointmentStats, roleBreakdown, datasetStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/export-data
router.get('/export-data', authMiddleware, adminOnly, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      data: users.map((u) => ({
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/training/datasets
// Loads dataset cards and the admin upload/training table.
router.get('/training/datasets', authMiddleware, adminOnly, async (req, res) => {
  try {
    const docs = await TrainingDataset.find().sort({ createdAt: -1 }).populate('uploadedBy', 'firstName lastName').populate('trainedBy', 'firstName lastName').lean();
    const datasets = docs.map((d) => ({
      id: String(d._id),
      name: d.name,
      originalName: d.originalName,
      storedName: d.storedName,
      filePath: d.filePath,
      fileType: d.fileType,
      fileSize: d.fileSize,
      rowCount: d.rowCount || 0,
      columnCount: d.columnCount || 0,
      sampleColumns: Array.isArray(d.sampleColumns) ? d.sampleColumns : [],
      targetModule: d.targetModule || 'general',
      notes: d.notes || '',
      status: d.status,
      uploadedByName: d.uploadedBy ? `${d.uploadedBy.firstName} ${d.uploadedBy.lastName}` : 'Admin',
      trainedByName: d.trainedBy ? `${d.trainedBy.firstName} ${d.trainedBy.lastName}` : null,
      trainingSummary: d.trainingSummary || null,
      uploadedAt: d.createdAt,
      trainedAt: d.trainedAt,
    }));

    const summary = {
      total: datasets.length,
      uploaded: datasets.filter((d) => d.status === 'uploaded').length,
      trained: datasets.filter((d) => d.status === 'trained').length,
      failed: datasets.filter((d) => d.status === 'failed').length,
      totalRows: datasets.reduce((sum, d) => sum + (d.rowCount || 0), 0),
    };

    res.json({ success: true, summary, datasets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/training/upload
// Stores dataset metadata and the uploaded file in /public/uploads/datasets.
router.post('/training/upload', authMiddleware, adminOnly, (req, res) => {
  datasetUpload.single('dataset')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Dataset file is required.' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const fullPath = path.join(ensureDatasetDir(), req.file.filename);
      const parsed = parseDatasetFile(fullPath, ext);

      const dataset = await TrainingDataset.create({
        name: String(req.body.name || path.basename(req.file.originalname, ext)).trim(),
        originalName: req.file.originalname,
        storedName: req.file.filename,
        filePath: `/uploads/datasets/${req.file.filename}`,
        fileType: ext.replace('.', '').toUpperCase(),
        fileSize: req.file.size,
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        sampleColumns: parsed.sampleColumns,
        targetModule: ['assessment', 'recommendation', 'general'].includes(req.body.targetModule) ? req.body.targetModule : 'general',
        notes: req.body.notes ? String(req.body.notes).trim() : null,
        uploadedBy: req.user.userId,
        status: 'uploaded',
      });

      res.status(201).json({ success: true, datasetId: String(dataset._id) });
    } catch (parseErr) {
      safeRemoveUpload(`/uploads/datasets/${req.file.filename}`);
      res.status(500).json({ error: parseErr.message });
    }
  });
});

// POST /api/admin/training/:id/train
// This marks the dataset as trained inside KinderCura's admin workflow.
// It does not run an external Python ML pipeline.
router.post('/training/:id/train', authMiddleware, adminOnly, async (req, res) => {
  try {
    const dataset = await TrainingDataset.findById(req.params.id);
    if (!dataset) return res.status(404).json({ error: 'Dataset not found.' });

    dataset.status = 'trained';
    dataset.trainedBy = req.user.userId;
    dataset.trainedAt = new Date();
    dataset.trainingSummary = `Dataset prepared for ${dataset.targetModule} model support. ${dataset.rowCount || 0} rows and ${dataset.columnCount || 0} columns were registered by the admin page.`;
    await dataset.save();

    res.json({ success: true, message: 'Dataset marked as trained.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/training/:id
router.delete('/training/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const dataset = await TrainingDataset.findByIdAndDelete(req.params.id);
    if (!dataset) return res.status(404).json({ error: 'Dataset not found.' });
    safeRemoveUpload(dataset.filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
