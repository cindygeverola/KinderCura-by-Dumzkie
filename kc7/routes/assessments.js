// routes/assessments.js
// MongoDB replacement for screening, results, and pediatrician patient assessment data.
// NOTE: Assessment data is saved in MongoDB collections through mongoose models.
// The database connection still comes from db.js, not from this file.
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const Assessment = require('../models/Assessment');
const AssessmentAnswer = require('../models/AssessmentAnswer');
const AssessmentResult = require('../models/AssessmentResult');
const Appointment = require('../models/Appointment');
const Child = require('../models/Child');
const User = require('../models/User');
const PatientProgressNote = require('../models/PatientProgressNote');

function getAgeInfo(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday = now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
  if (beforeBirthday) age -= 1;
  if (age >= 3 && age <= 5) return { group: 'preschool', age, label: 'Preschool (Ages 3–5)' };
  if (age >= 6 && age <= 8) return { group: 'school', age, label: 'Early School Age (Ages 6–8)' };
  return null;
}

function scoreAnswer(answer) {
  if (answer === 'yes') return 2;
  if (answer === 'sometimes') return 1;
  return 0;
}

function getStatus(score) {
  if (score >= 70) return 'on-track';
  if (score >= 40) return 'at-risk';
  return 'delayed';
}

function normalizeAnswers(answers) {
  if (!answers) return [];
  if (Array.isArray(answers)) return answers;
  // save-draft may send a plain object of questionId -> answer
  return Object.entries(answers).map(([questionId, answer]) => ({
    questionId,
    domain: 'Unknown',
    questionText: '',
    answer,
  }));
}

async function buildHistoryForChild(childId) {
  const assessments = await Assessment.find({ childId }).sort({ startedAt: -1 }).lean();
  const assessmentIds = assessments.map((a) => a._id);
  const results = await AssessmentResult.find({ assessmentId: { $in: assessmentIds } }).lean();
  const resultMap = new Map(results.map((r) => [String(r.assessmentId), r]));

  return assessments.map((a) => {
    const r = resultMap.get(String(a._id));
    return {
      id: String(a._id),
      childId: String(a.childId),
      status: a.status,
      currentProgress: a.currentProgress,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      diagnosis: a.diagnosis || null,
      recommendations: a.recommendations || null,
      communicationScore: r?.communicationScore ?? null,
      socialScore: r?.socialScore ?? null,
      cognitiveScore: r?.cognitiveScore ?? null,
      motorScore: r?.motorScore ?? null,
      overallScore: r?.overallScore ?? null,
    };
  });
}

// POST /api/assessments/initialize
router.post('/initialize', authMiddleware, async (req, res) => {
  try {
    const { childId } = req.body;
    if (!childId) return res.status(400).json({ error: 'childId is required.' });

    const child = await Child.findOne({ _id: childId, parentId: req.user.userId });
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const ageInfo = getAgeInfo(child.dateOfBirth);
    if (!ageInfo) return res.status(400).json({ error: 'Child must be between ages 3-8 for screening.' });

    const assessment = await Assessment.create({
      childId: child._id,
      createdBy: req.user.userId,
      status: 'in_progress',
      currentProgress: 0,
      startedAt: new Date(),
    });

    res.json({
      success: true,
      assessmentId: String(assessment._id),
      ageGroup: ageInfo.group,
      ageLabel: ageInfo.label,
      childAge: ageInfo.age,
      totalQuestions: 20,
      questions: [], // frontend already has the question list hardcoded
    });
  } catch (err) {
    console.error('assessments initialize error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assessments/save-draft
router.post('/save-draft', authMiddleware, async (req, res) => {
  try {
    const { assessmentId, progress, answers } = req.body;
    if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required.' });

    await Assessment.findByIdAndUpdate(assessmentId, { currentProgress: progress || 0 });

    const answersArray = normalizeAnswers(answers);
    for (const a of answersArray) {
      if (!a.questionId || !a.answer) continue;
      await AssessmentAnswer.findOneAndUpdate(
        { assessmentId, questionId: String(a.questionId) },
        {
          assessmentId,
          questionId: String(a.questionId),
          domain: a.domain || 'Unknown',
          questionText: a.questionText || '',
          answer: a.answer,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('assessments save-draft error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assessments/submit
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    let { assessmentId, childId, answers } = req.body;
    const answersArray = normalizeAnswers(answers);

    if (!childId) return res.status(400).json({ error: 'childId is required.' });

    let assessment = assessmentId ? await Assessment.findById(assessmentId) : null;
    if (!assessment) {
      assessment = await Assessment.create({
        childId,
        createdBy: req.user.userId,
        status: 'in_progress',
        currentProgress: 100,
        startedAt: new Date(),
      });
      assessmentId = String(assessment._id);
    }

    for (const a of answersArray) {
      if (!a.questionId || !a.answer) continue;
      await AssessmentAnswer.findOneAndUpdate(
        { assessmentId, questionId: String(a.questionId) },
        {
          assessmentId,
          questionId: String(a.questionId),
          domain: a.domain || 'Unknown',
          questionText: a.questionText || '',
          answer: a.answer,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    const storedAnswers = await AssessmentAnswer.find({ assessmentId }).lean();
    const totals = {
      Communication: { earned: 0, total: 0 },
      'Social Skills': { earned: 0, total: 0 },
      Cognitive: { earned: 0, total: 0 },
      'Motor Skills': { earned: 0, total: 0 },
    };

    for (const a of storedAnswers) {
      if (!totals[a.domain]) continue;
      totals[a.domain].total += 2;
      totals[a.domain].earned += scoreAnswer(a.answer);
    }

    const communicationScore = totals.Communication.total ? Math.round((totals.Communication.earned / totals.Communication.total) * 100) : 0;
    const socialScore        = totals['Social Skills'].total ? Math.round((totals['Social Skills'].earned / totals['Social Skills'].total) * 100) : 0;
    const cognitiveScore     = totals.Cognitive.total ? Math.round((totals.Cognitive.earned / totals.Cognitive.total) * 100) : 0;
    const motorScore         = totals['Motor Skills'].total ? Math.round((totals['Motor Skills'].earned / totals['Motor Skills'].total) * 100) : 0;
    const overallScore       = Math.round((communicationScore + socialScore + cognitiveScore + motorScore) / 4);

    const riskFlags = [];
    if (communicationScore < 40) riskFlags.push('Communication delay detected');
    if (socialScore < 40) riskFlags.push('Social skills concern detected');
    if (cognitiveScore < 40) riskFlags.push('Cognitive development concern');
    if (motorScore < 40) riskFlags.push('Motor skills delay detected');

    const result = await AssessmentResult.findOneAndUpdate(
      { assessmentId },
      {
        assessmentId,
        childId,
        communicationScore,
        socialScore,
        cognitiveScore,
        motorScore,
        overallScore,
        communicationStatus: getStatus(communicationScore),
        socialStatus: getStatus(socialScore),
        cognitiveStatus: getStatus(cognitiveScore),
        motorStatus: getStatus(motorScore),
        riskFlags,
        generatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Assessment.findByIdAndUpdate(assessmentId, {
      status: 'complete',
      currentProgress: 100,
      completedAt: new Date(),
    });

    res.json({ success: true, resultId: String(result._id), assessmentId: String(assessmentId), analysisStatus: 'complete' });
  } catch (err) {
    console.error('assessments submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/assessments/pedia-patients
router.get('/pedia-patients', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const appointments = await Appointment.find({ pediatricianId: req.user.userId }).sort({ appointmentDate: -1, createdAt: -1 }).lean();
    const uniqueByChild = new Map();
    for (const a of appointments) {
      const key = String(a.childId);
      const current = uniqueByChild.get(key);
      if (!current || a.id > current.id) uniqueByChild.set(key, a);
    }

    const patients = [];
    for (const appt of uniqueByChild.values()) {
      const [child, parent, latestAssessment, latestProgressNote, progressNotesCount] = await Promise.all([
        Child.findById(appt.childId).lean(),
        User.findById(appt.parentId).lean(),
        Assessment.findOne({ childId: appt.childId }).sort({ startedAt: -1 }).lean(),
        PatientProgressNote.findOne({ childId: appt.childId, pediatricianId: req.user.userId }).sort({ createdAt: -1 }).lean(),
        PatientProgressNote.countDocuments({ childId: appt.childId, pediatricianId: req.user.userId }),
      ]);
      const latestResult = latestAssessment ? await AssessmentResult.findOne({ assessmentId: latestAssessment._id }).lean() : null;

      patients.push({
        childId: child ? String(child._id) : null,
        childFirstName: child?.firstName || '',
        childLastName: child?.lastName || '',
        childDateOfBirth: child?.dateOfBirth || null,
        childGender: child?.gender || null,
        childProfileIcon: child?.profileIcon || null,
        parentFirstName: parent?.firstName || '',
        parentLastName: parent?.lastName || '',
        parentEmail: parent?.email || '',
        appointmentId: appt.id,
        appointmentStatus: appt.status,
        appointmentDate: appt.appointmentDate,
        reason: appt.reason,
        communicationScore: latestResult?.communicationScore ?? null,
        socialScore: latestResult?.socialScore ?? null,
        cognitiveScore: latestResult?.cognitiveScore ?? null,
        motorScore: latestResult?.motorScore ?? null,
        overallScore: latestResult?.overallScore ?? null,
        lastAssessmentDate: latestResult?.generatedAt ?? null,
        assessmentId: latestAssessment ? String(latestAssessment._id) : null,
        diagnosis: latestAssessment?.diagnosis || null,
        recommendations: latestAssessment?.recommendations || null,
        latestProgressStatus: latestProgressNote?.progressStatus || null,
        latestProgressNote: latestProgressNote?.note || null,
        latestProgressAt: latestProgressNote?.createdAt || null,
        progressNotesCount,
      });
    }

    res.json({
      success: true,
      patients: patients.map((p) => ({
        ...p,
        scores: p.communicationScore != null ? {
          Communication: Math.round(p.communicationScore),
          'Social Skills': Math.round(p.socialScore),
          Cognitive: Math.round(p.cognitiveScore),
          'Motor Skills': Math.round(p.motorScore),
        } : {},
      })),
    });
  } catch (err) {
    console.error('assessments pedia-patients error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assessments/diagnose/:childId
router.post('/diagnose/:childId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const { diagnosis, recommendations } = req.body;
    if (!diagnosis) return res.status(400).json({ error: 'Diagnosis is required.' });

    const latest = await Assessment.findOne({ childId: req.params.childId }).sort({ startedAt: -1 });
    if (!latest) return res.status(404).json({ error: 'No assessment found for this child.' });

    latest.diagnosis = diagnosis;
    latest.recommendations = recommendations || null;
    await latest.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/assessments/:assessmentId/results
router.get('/:assessmentId/results', authMiddleware, async (req, res) => {
  try {
    const result = await AssessmentResult.findOne({ assessmentId: req.params.assessmentId }).lean();
    if (!result) return res.status(404).json({ error: 'Results not found.' });

    res.json({
      success: true,
      results: {
        id: String(result._id),
        assessmentId: String(result.assessmentId),
        childId: String(result.childId),
        communicationScore: result.communicationScore,
        socialScore: result.socialScore,
        cognitiveScore: result.cognitiveScore,
        motorScore: result.motorScore,
        overallScore: result.overallScore,
        communicationStatus: result.communicationStatus,
        socialStatus: result.socialStatus,
        cognitiveStatus: result.cognitiveStatus,
        motorStatus: result.motorStatus,
        riskFlags: Array.isArray(result.riskFlags) ? result.riskFlags : [],
        generatedAt: result.generatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/assessments/:childId/history
router.get('/:childId/history', authMiddleware, async (req, res) => {
  try {
    const child = await Child.findById(req.params.childId).lean();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const isParentOwner = String(child.parentId) === String(req.user.userId);
    const isPediaLinked = req.user.role === 'pediatrician' && await Appointment.exists({ childId: child._id, pediatricianId: req.user.userId });
    if (!isParentOwner && !isPediaLinked && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const history = await buildHistoryForChild(child._id);
    res.json({ success: true, assessments: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/assessments/child/:childId/progress-notes
// Returns the pediatrician progress notes and follow-up history for one child.
router.get('/child/:childId/progress-notes', authMiddleware, async (req, res) => {
  try {
    const child = await Child.findById(req.params.childId).lean();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const isParentOwner = String(child.parentId) === String(req.user.userId);
    const isPediaLinked = req.user.role === 'pediatrician' && await Appointment.exists({ childId: child._id, pediatricianId: req.user.userId });
    if (!isParentOwner && !isPediaLinked && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const noteFilter = { childId: child._id };
    // Pediatricians only need to see their own note timeline on the My Patients page.
    if (req.user.role === 'pediatrician') noteFilter.pediatricianId = req.user.userId;

    const notes = await PatientProgressNote.find(noteFilter)
      .populate('pediatricianId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      notes: notes.map((n) => ({
        id: n.id,
        mongoId: String(n._id),
        childId: String(n.childId),
        appointmentId: n.appointmentId || null,
        assessmentId: n.assessmentId ? String(n.assessmentId) : null,
        progressStatus: n.progressStatus,
        note: n.note,
        pediatricianName: n.pediatricianId?.firstName
          ? `${n.pediatricianId.firstName} ${n.pediatricianId.lastName || ''}`.trim()
          : 'Pediatrician',
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    });
  } catch (err) {
    console.error('assessments progress-notes get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assessments/child/:childId/progress-notes
// Saves one pediatrician follow-up note so patient progress can be tracked over time.
router.post('/child/:childId/progress-notes', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const { progressStatus, note } = req.body;
    if (!note || !String(note).trim()) {
      return res.status(400).json({ error: 'Progress note is required.' });
    }

    const child = await Child.findById(req.params.childId).lean();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const linkedAppointment = await Appointment.findOne({
      childId: child._id,
      pediatricianId: req.user.userId,
    }).sort({ appointmentDate: -1, createdAt: -1 }).lean();

    if (!linkedAppointment) {
      return res.status(403).json({ error: 'You can only update progress for your own patients.' });
    }

    const latestAssessment = await Assessment.findOne({ childId: child._id }).sort({ startedAt: -1 }).lean();
    const VALID_STATUSES = ['initial_review','monitoring','follow_up','improving','stable','needs_attention','referred','completed'];
    const safeStatus = VALID_STATUSES.includes(String(progressStatus || '').trim()) ? String(progressStatus).trim() : 'monitoring';

    const created = await PatientProgressNote.create({
      childId: child._id,
      pediatricianId: req.user.userId,
      appointmentId: linkedAppointment.id,
      assessmentId: latestAssessment ? latestAssessment._id : null,
      progressStatus: safeStatus,
      note: String(note).trim(),
    });

    res.status(201).json({
      success: true,
      note: {
        id: created.id,
        mongoId: String(created._id),
        progressStatus: created.progressStatus,
        note: created.note,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    console.error('assessments progress-notes post error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;