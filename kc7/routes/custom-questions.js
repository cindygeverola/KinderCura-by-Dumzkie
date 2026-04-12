// Custom questions routes (MongoDB version)
// Purpose:
// - lets pediatricians create, edit, delete, and assign their own assessment questions
// - stores question records in MongoDB instead of SQL Server
// - sends a parent notification when a question is assigned
// Note: This file does NOT open the database connection by itself.
// The MongoDB connection string is still read from db.js using process.env.MONGODB_URI.

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middleware/auth');
const CustomQuestion = require('../models/CustomQuestion');
const CustomQuestionAssignment = require('../models/CustomQuestionAssignment');
const Child = require('../models/Child');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');

// Formats the MongoDB document into the frontend shape used by pedia-questions.html
function normalizeQuestion(doc) {
  return {
    id: doc.id,
    questionText: doc.questionText,
    questionType: doc.questionType,
    options: Array.isArray(doc.options) ? doc.options : [],
    domain: doc.domain || 'Other',
    ageMin: doc.ageMin ?? 0,
    ageMax: doc.ageMax ?? 18,
    isActive: Boolean(doc.isActive),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizeAssignment(doc) {
  const q = doc.questionId || {};
  const ped = q.pediatricianId || {};
  return {
    assignmentId: doc.id,
    appointmentId: doc.appointmentId || null,
    answer: doc.answer || null,
    answeredAt: doc.answeredAt || null,
    questionId: q.id,
    questionText: q.questionText,
    questionType: q.questionType,
    options: Array.isArray(q.options) ? q.options : [],
    domain: q.domain || 'Other',
    ageMin: q.ageMin ?? 0,
    ageMax: q.ageMax ?? 18,
    pediatricianName: ped.firstName ? `${ped.firstName} ${ped.lastName || ''}`.trim() : 'Pediatrician',
  };
}

// Safety check: pediatricians can only assign questions to children linked to them by appointment
async function ensurePediaChildRelationship(pediatricianObjectId, childObjectId, appointmentId = null) {
  const filter = {
    pediatricianId: pediatricianObjectId,
    childId: childObjectId,
    status: { $in: ['approved', 'completed', 'pending'] },
  };
  if (appointmentId != null) filter.id = appointmentId;
  return Appointment.findOne(filter).lean();
}

// GET /api/questions
// Load all custom questions created by the logged-in pediatrician
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const questions = await CustomQuestion.find({ pediatricianId: req.user.userId })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, questions: questions.map(normalizeQuestion) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/questions
// Create one new custom question
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const { questionText, questionType, options, domain, ageMin, ageMax } = req.body;

    if (!questionText || !questionType) {
      return res.status(400).json({ error: 'Question text and type are required.' });
    }

    const VALID_TYPES = ['yes_no', 'multiple_choice', 'short_answer'];
    if (!VALID_TYPES.includes(questionType)) {
      return res.status(400).json({ error: `Type must be: ${VALID_TYPES.join(', ')}` });
    }

    const cleanOptions = Array.isArray(options)
      ? options.map((o) => String(o).trim()).filter(Boolean)
      : [];

    if (questionType === 'multiple_choice' && cleanOptions.length < 2) {
      return res.status(400).json({ error: 'Multiple choice questions require at least 2 options.' });
    }

    const doc = await CustomQuestion.create({
      pediatricianId: req.user.userId,
      questionText: String(questionText).trim(),
      questionType,
      options: questionType === 'multiple_choice' ? cleanOptions : [],
      domain: domain || 'Other',
      ageMin: ageMin != null ? Number(ageMin) : 0,
      ageMax: ageMax != null ? Number(ageMax) : 18,
      isActive: true,
    });

    res.status(201).json({ success: true, question: normalizeQuestion(doc.toObject()) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/questions/:id
// Edit an existing custom question
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const doc = await CustomQuestion.findOne({ id: Number(req.params.id), pediatricianId: req.user.userId });
    if (!doc) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const { questionText, questionType, options, domain, ageMin, ageMax, isActive } = req.body;

    if (questionText !== undefined) doc.questionText = String(questionText).trim();
    if (questionType !== undefined) doc.questionType = questionType;
    if (options !== undefined) {
      doc.options = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [];
    }
    if (domain !== undefined) doc.domain = domain || 'Other';
    if (ageMin !== undefined) doc.ageMin = Number(ageMin);
    if (ageMax !== undefined) doc.ageMax = Number(ageMax);
    if (isActive !== undefined) doc.isActive = Boolean(isActive);

    if (doc.questionType === 'multiple_choice' && doc.options.length < 2) {
      return res.status(400).json({ error: 'Multiple choice questions require at least 2 options.' });
    }

    await doc.save();
    res.json({ success: true, question: normalizeQuestion(doc.toObject()) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/questions/:id
// Delete a custom question and its assignments
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const doc = await CustomQuestion.findOne({ id: Number(req.params.id), pediatricianId: req.user.userId });
    if (!doc) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    await CustomQuestionAssignment.deleteMany({ questionId: doc._id });
    await doc.deleteOne();

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/questions/:id/assign
// Assign one question to one child (optionally tied to an appointment)
router.post('/:id/assign', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const { childId, appointmentId } = req.body;
    if (!childId) {
      return res.status(400).json({ error: 'childId is required.' });
    }

    const question = await CustomQuestion.findOne({ id: Number(req.params.id), pediatricianId: req.user.userId });
    if (!question) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const child = await Child.findById(childId).lean();
    if (!child) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    const relationship = await ensurePediaChildRelationship(req.user.userId, child._id, appointmentId || null);
    if (!relationship) {
      return res.status(403).json({ error: 'You can only assign questions to your own patients.' });
    }

    const existing = await CustomQuestionAssignment.findOne({
      questionId: question._id,
      childId: child._id,
      appointmentId: appointmentId || null,
    }).lean();

    if (existing) {
      return res.json({ success: true, message: 'Already assigned.' });
    }

    const assignment = await CustomQuestionAssignment.create({
      questionId: question._id,
      appointmentId: appointmentId || null,
      childId: child._id,
      parentId: child.parentId,
    });

    const ped = await User.findById(req.user.userId).select('firstName lastName').lean();

    // Create an in-app notification so the parent knows there is a new question
    await Notification.create({
      userId: child.parentId,
      title: '📋 New Assessment Question',
      message: `Dr. ${ped?.firstName || ''} ${ped?.lastName || ''} assigned a new custom question for ${child.firstName}.`.trim(),
      type: 'assessment',
    });

    res.json({ success: true, assignmentId: assignment.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/questions/assigned/:childId
router.get('/assigned/:childId', authMiddleware, async (req, res) => {
  try {
    const child = await Child.findById(req.params.childId).lean();
    if (!child) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    if (req.user.role === 'parent' && String(child.parentId) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (req.user.role === 'pediatrician') {
      const rel = await ensurePediaChildRelationship(req.user.userId, child._id);
      if (!rel) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const assignments = await CustomQuestionAssignment.find({ childId: child._id })
      .populate({
        path: 'questionId',
        populate: { path: 'pediatricianId', select: 'firstName lastName' },
      })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, assignments: assignments.map(normalizeAssignment) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/questions/answer/:assignmentId
router.post('/answer/:assignmentId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ error: 'Parents only.' });
    }

    const { answer } = req.body;
    if (!answer) {
      return res.status(400).json({ error: 'Answer required.' });
    }

    const assignment = await CustomQuestionAssignment.findOne({ id: Number(req.params.assignmentId), parentId: req.user.userId })
      .populate({ path: 'questionId', populate: { path: 'pediatricianId', select: 'firstName lastName _id' } });

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found.' });
    }

    assignment.answer = String(answer);
    assignment.answeredAt = new Date();
    await assignment.save();

    // Notify the pediatrician right away once the parent submits the answer
    const pedId = assignment.questionId?.pediatricianId?._id;
    if (pedId) {
      const child = await Child.findById(assignment.childId).select('firstName lastName').lean();
      const childName = child ? `${child.firstName || ''} ${child.lastName || ''}`.trim() : 'a child';
      const questionText = String(assignment.questionId?.questionText || 'your custom question').trim();
      const shortAnswer = String(answer).trim().slice(0, 80);

      await Notification.create({
        userId: pedId,
        title: '📝 Custom Question Answered',
        message: `${childName}'s parent answered: "${questionText}" — Answer: ${shortAnswer}`,
        type: 'assessment',
      });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
