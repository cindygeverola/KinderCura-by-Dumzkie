// routes/recommendations.js
// MongoDB recommendation route with suggested pediatrician / clinic support.
// Important:
// - still returns the domain recommendations used by the parent page
// - now also suggests active pediatricians based on the child's latest assessment result
// - tells the frontend if the child already has a consultation booked
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const AssessmentResult = require('../models/AssessmentResult');
const Recommendation = require('../models/Recommendation');
const Assessment = require('../models/Assessment');
const Appointment = require('../models/Appointment');
const User = require('../models/User');

function buildRecommendationSet(resultDoc) {
  const suggestionMap = {
    communication: {
      high:   { suggestion: 'Continue encouraging verbal communication through storytelling and reading aloud daily.', activities: ['Read together 20 min/day', 'Ask open-ended questions', 'Sing songs and nursery rhymes'] },
      medium: { suggestion: 'Practice conversation skills and expand vocabulary with daily activities.', activities: ['Describe pictures in books', 'Play word games', 'Talk during daily routines'] },
      low:    { suggestion: 'Immediate speech therapy evaluation recommended. Focus on basic communication cues.', activities: ['Consult a speech therapist', 'Use picture cards for communication', 'Practice simple words daily'] },
    },
    social: {
      high:   { suggestion: 'Encourage group play and cooperative activities to further develop social bonds.', activities: ['Arrange playdates', 'Team sports or group classes', 'Board games with family'] },
      medium: { suggestion: 'Increase opportunities for peer interaction in structured settings.', activities: ['Join a playgroup', 'Practice turn-taking games', 'Role-play social scenarios'] },
      low:    { suggestion: 'Consider evaluation for social development support. Structured social programs recommended.', activities: ['Consult a developmental pediatrician', 'Social skills groups', 'Gradual peer exposure'] },
    },
    cognitive: {
      high:   { suggestion: 'Challenge with age-appropriate puzzles and creative problem-solving activities.', activities: ['Puzzles and building blocks', 'Science experiments', 'Memory games'] },
      medium: { suggestion: 'Incorporate more hands-on learning and exploratory play.', activities: ['Sorting and counting games', 'Simple cooking together', 'Nature exploration'] },
      low:    { suggestion: 'Cognitive development evaluation recommended. Focus on foundational learning skills.', activities: ['Consult a developmental specialist', 'Shape and color recognition', 'Simple cause-and-effect toys'] },
    },
    motor: {
      high:   { suggestion: 'Support fine and gross motor development through active play and art.', activities: ['Drawing and coloring', 'Outdoor play', 'Dance and movement activities'] },
      medium: { suggestion: 'Increase physical activities that challenge both fine and gross motor skills.', activities: ['Playdough and clay activities', 'Tricycle or bike riding', 'Climbing structures'] },
      low:    { suggestion: 'Occupational therapy evaluation recommended to address motor skill delays.', activities: ['Consult an occupational therapist', 'Finger strengthening exercises', 'Balance and coordination activities'] },
    },
  };

  const domains = [
    { key: 'communication', score: resultDoc.communicationScore },
    { key: 'social',        score: resultDoc.socialScore },
    { key: 'cognitive',     score: resultDoc.cognitiveScore },
    { key: 'motor',         score: resultDoc.motorScore },
  ];

  return domains.map((d) => {
    const priority = d.score >= 70 ? 'low' : d.score >= 40 ? 'medium' : 'high';
    const level = d.score >= 70 ? 'high' : d.score >= 40 ? 'medium' : 'low';
    const info = suggestionMap[d.key][level];
    return {
      skill: d.key,
      priority,
      suggestion: info.suggestion,
      activities: info.activities,
      consultationNeeded: d.score < 40,
    };
  });
}

function clinicNameFor(pediatrician) {
  return pediatrician?.clinicName || pediatrician?.institution || null;
}

function clinicAddressFor(pediatrician) {
  return pediatrician?.clinicAddress || null;
}

function buildAssessmentContext(resultDoc) {
  const domains = [
    { key: 'communication', label: 'Communication', score: Number(resultDoc.communicationScore || 0), keywords: ['communication', 'speech', 'language', 'behavior', 'development'] },
    { key: 'social', label: 'Social Skills', score: Number(resultDoc.socialScore || 0), keywords: ['social', 'behavior', 'interaction', 'development'] },
    { key: 'cognitive', label: 'Cognitive', score: Number(resultDoc.cognitiveScore || 0), keywords: ['cognitive', 'development', 'learning', 'behavior', 'neuro'] },
    { key: 'motor', label: 'Motor Skills', score: Number(resultDoc.motorScore || 0), keywords: ['motor', 'occupational', 'physical', 'movement', 'development'] },
  ];

  const focusAreas = domains.filter((d) => d.score < 70).sort((a, b) => a.score - b.score);
  const consultationNeeded = focusAreas.length > 0;
  const urgent = focusAreas.some((d) => d.score < 40);

  let summary = 'You may continue monitoring your child while using the generated home activities.';
  if (consultationNeeded) {
    const areaNames = focusAreas.slice(0, 2).map((d) => d.label).join(' and ');
    summary = urgent
      ? `KinderCura suggests prioritizing clinic support for ${areaNames}.`
      : `A follow-up pediatric consultation may help support ${areaNames}.`;
  }

  return { focusAreas, consultationNeeded, urgent, summary };
}

function scorePediatricianForContext(pediatrician, context) {
  const hay = `${pediatrician.specialization || ''} ${pediatrician.clinicName || ''} ${pediatrician.institution || ''} ${pediatrician.bio || ''}`.toLowerCase();
  let score = 0;
  const reasons = [];

  for (const area of context.focusAreas) {
    if (area.keywords.some((kw) => hay.includes(kw))) {
      score += area.score < 40 ? 8 : 5;
      reasons.push(`${area.label} support match`);
    }
  }

  if (/pediatric|development|child/.test(hay)) {
    score += 2;
    reasons.push('child development care');
  }
  if (clinicNameFor(pediatrician)) score += 1;
  if (clinicAddressFor(pediatrician)) score += 1;
  if (pediatrician.consultationFee != null) score += 1;

  return {
    score,
    reason: reasons[0] || (context.consultationNeeded ? 'general pediatric follow-up' : 'active pediatrician'),
  };
}

async function buildSuggestedPediatricians(resultDoc) {
  const context = buildAssessmentContext(resultDoc);
  const pediatricians = await User.find({ role: 'pediatrician', status: 'active' })
    .select('firstName lastName specialization institution clinicName clinicAddress phoneNumber consultationFee profileIcon availability bio')
    .sort({ firstName: 1, lastName: 1 })
    .lean();

  const suggestions = pediatricians.map((p) => {
    const match = scorePediatricianForContext(p, context);
    return {
      id: String(p._id),
      firstName: p.firstName,
      lastName: p.lastName,
      specialization: p.specialization || null,
      institution: p.institution || null,
      clinicName: clinicNameFor(p),
      clinicAddress: clinicAddressFor(p),
      phoneNumber: p.phoneNumber || null,
      consultationFee: p.consultationFee ?? null,
      profileIcon: p.profileIcon || null,
      availability: {
        days: Array.isArray(p.availability?.days) ? p.availability.days : [],
        startTime: p.availability?.startTime || '09:00',
        endTime: p.availability?.endTime || '17:00',
        maxPatientsPerDay: p.availability?.maxPatientsPerDay ?? 10,
      },
      isSuggested: context.consultationNeeded ? match.score > 0 : false,
      matchScore: match.score,
      suggestedReason: match.reason,
    };
  }).sort((a, b) => (b.matchScore - a.matchScore) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

  return {
    context: {
      consultationNeeded: context.consultationNeeded,
      urgent: context.urgent,
      focusAreas: context.focusAreas.map((a) => a.label),
      summary: context.summary,
    },
    pediatricians: suggestions,
  };
}

router.get('/:assessmentId', authMiddleware, async (req, res) => {
  try {
    const assessmentId = req.params.assessmentId;
    const assessment = await Assessment.findById(assessmentId).lean();
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found.' });
    }

    // Parents may only read their own child's recommendation set.
    if (req.user.role === 'parent') {
      const ownerAppointmentsOrAssessment = String(assessment.createdBy) === String(req.user.userId);
      if (!ownerAppointmentsOrAssessment) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const resultDoc = await AssessmentResult.findOne({ assessmentId });
    if (!resultDoc) {
      return res.status(404).json({ error: 'Assessment results not found.' });
    }

    let recDocs = await Recommendation.find({ assessmentResultId: resultDoc._id }).sort({ generatedAt: 1 }).lean();
    if (!recDocs.length) {
      const generated = buildRecommendationSet(resultDoc).map((r) => ({
        assessmentResultId: resultDoc._id,
        childId: resultDoc.childId,
        ...r,
      }));
      await Recommendation.insertMany(generated);
      recDocs = await Recommendation.find({ assessmentResultId: resultDoc._id }).sort({ generatedAt: 1 }).lean();
    }

    const recommendations = recDocs.map((r) => ({
      id: String(r._id),
      assessmentResultId: String(r.assessmentResultId),
      childId: String(r.childId),
      skill: r.skill,
      priority: r.priority,
      suggestion: r.suggestion,
      activities: Array.isArray(r.activities) ? r.activities : [],
      consultationNeeded: Boolean(r.consultationNeeded),
      generatedAt: r.generatedAt,
    }));

    const [suggested, bookedCount] = await Promise.all([
      buildSuggestedPediatricians(resultDoc),
      Appointment.countDocuments({
        childId: resultDoc.childId,
        status: { $in: ['pending', 'approved', 'completed'] },
      }),
    ]);

    res.json({
      success: true,
      consultationNeeded: suggested.context.consultationNeeded,
      urgent: suggested.context.urgent,
      focusAreas: suggested.context.focusAreas,
      suggestionSummary: suggested.context.summary,
      bookedConsultation: bookedCount > 0,
      suggestedPediatricians: suggested.pediatricians.slice(0, 5),
      recommendations,
    });
  } catch (err) {
    console.error('recommendations load error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
