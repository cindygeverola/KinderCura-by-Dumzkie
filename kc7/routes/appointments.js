// routes/appointments.js
// MongoDB replacement for parent + pediatrician appointment features.
// NOTE: This file does not open MongoDB by itself.
// It uses the mongoose connection that server.js starts through db.js.
const express = require('express');
const nodemailer = require('nodemailer');
require('dotenv').config();

const { authMiddleware } = require('../middleware/auth');
const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Child = require('../models/Child');
const Assessment = require('../models/Assessment');
const AssessmentResult = require('../models/AssessmentResult');

const router = express.Router();

// Optional Gmail sender. If EMAIL_USER / EMAIL_PASS are not set, the app still works.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const emailConfigured = () => Boolean(
  process.env.EMAIL_USER &&
  process.env.EMAIL_PASS &&
  process.env.EMAIL_USER !== 'your_email@gmail.com' &&
  process.env.EMAIL_PASS !== 'your_gmail_app_password'
);

function wrapEmail(content) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
    <div style="background:#6B8E6F;padding:20px;text-align:center;border-radius:10px 10px 0 0;">
      <h1 style="color:white;margin:0;"><span style="color:#E8A5A5;">Kinder</span>Cura</h1>
    </div>
    <div style="background:#f9f9f9;padding:28px;border-radius:0 0 10px 10px;">${content}</div>
    <p style="text-align:center;color:#aaa;font-size:0.78rem;margin-top:12px;">KinderCura — Supporting Your Child's Development Journey</p>
  </div>`;
}

async function sendEmail(to, subject, html) {
  if (!emailConfigured() || !to) {
    console.log(`\n[EMAIL SKIPPED] To: ${to || 'n/a'} | Subject: ${subject}\n`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"KinderCura" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html: wrapEmail(html),
    });
  } catch (err) {
    console.error('Appointment email error:', err.message);
  }
}

async function pushNotification(userId, title, message, type = 'appointment') {
  await Notification.create({ userId, title, message, type, isRead: false });
}

function fmtDate(dateValue) {
  if (!dateValue) return '—';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return String(dateValue);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function fmtTime(timeValue) {
  if (!timeValue) return '—';
  const s = String(timeValue);
  // Accept HH:mm or HH:mm:ss
  const [rawH, rawM] = s.split(':');
  const h = parseInt(rawH, 10);
  const m = String(rawM || '00').padStart(2, '0');
  if (Number.isNaN(h)) return s;
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

function calcAge(dateOfBirth) {
  if (!dateOfBirth) return '—';
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let y = now.getFullYear() - dob.getFullYear();
  let m = now.getMonth() - dob.getMonth();
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  if (y <= 0) return `${m} month${m !== 1 ? 's' : ''}`;
  return `${y} year${y !== 1 ? 's' : ''} ${m} month${m !== 1 ? 's' : ''}`.trim();
}


function safeText(value) {
  return String(value || '').trim();
}

function clinicNameFor(pediatrician) {
  return pediatrician?.clinicName || pediatrician?.institution || null;
}

function clinicAddressFor(pediatrician) {
  return pediatrician?.clinicAddress || null;
}

async function getLatestAssessmentResultForChild(childId) {
  if (!childId) return null;
  const latestAssessment = await Assessment.findOne({ childId, status: 'complete' })
    .sort({ completedAt: -1, startedAt: -1, createdAt: -1 })
    .lean();
  if (!latestAssessment) return null;
  const result = await AssessmentResult.findOne({ assessmentId: latestAssessment._id }).lean();
  if (!result) return null;
  return { assessment: latestAssessment, result };
}

function buildAssessmentContext(resultDoc) {
  if (!resultDoc) {
    return {
      hasAssessment: false,
      consultationNeeded: false,
      urgent: false,
      focusAreas: [],
      summary: 'You can still choose any active pediatrician for your child.',
    };
  }

  const domains = [
    { key: 'communication', label: 'Communication', score: Number(resultDoc.communicationScore || 0), keywords: ['communication', 'speech', 'language', 'behavior', 'development'] },
    { key: 'social', label: 'Social Skills', score: Number(resultDoc.socialScore || 0), keywords: ['social', 'behavior', 'interaction', 'development'] },
    { key: 'cognitive', label: 'Cognitive', score: Number(resultDoc.cognitiveScore || 0), keywords: ['cognitive', 'development', 'behavior', 'learning', 'neuro'] },
    { key: 'motor', label: 'Motor Skills', score: Number(resultDoc.motorScore || 0), keywords: ['motor', 'occupational', 'physical', 'development', 'movement'] },
  ];

  const focusAreas = domains
    .filter((d) => d.score < 70)
    .sort((a, b) => a.score - b.score);

  const urgent = focusAreas.some((d) => d.score < 40);
  const consultationNeeded = focusAreas.length > 0;

  let summary = 'You can book an appointment with any active pediatrician.';
  if (consultationNeeded) {
    const names = focusAreas.slice(0, 2).map((d) => d.label).join(' and ');
    summary = urgent
      ? `KinderCura suggests prioritizing a pediatrician who can support ${names}.`
      : `A follow-up consultation may help support ${names}.`;
  }

  return { hasAssessment: true, consultationNeeded, urgent, focusAreas, summary };
}

function scorePediatricianForContext(pediatrician, context) {
  const hay = `${safeText(pediatrician.specialization)} ${safeText(pediatrician.clinicName)} ${safeText(pediatrician.institution)} ${safeText(pediatrician.bio)}`.toLowerCase();
  let score = 0;
  const reasons = [];

  if (context.consultationNeeded) {
    for (const area of context.focusAreas) {
      if (area.keywords.some((kw) => hay.includes(kw))) {
        score += area.score < 40 ? 8 : 5;
        reasons.push(`${area.label} support match`);
      }
    }
  }

  if (/pediatric|development|child/.test(hay)) {
    score += 2;
    reasons.push('pediatric development care');
  }
  if (clinicNameFor(pediatrician)) score += 1;
  if (clinicAddressFor(pediatrician)) score += 1;
  if (pediatrician.consultationFee != null) score += 1;

  return {
    score,
    reason: reasons.length ? reasons[0] : (context.consultationNeeded ? 'general pediatric follow-up' : 'active pediatrician'),
  };
}

async function buildSuggestedPediatricians({ childId = null } = {}) {
  const latest = childId ? await getLatestAssessmentResultForChild(childId) : null;
  const context = buildAssessmentContext(latest?.result || null);

  const pediatricians = await User.find({ role: 'pediatrician', status: 'active' })
    .select('firstName lastName specialization institution clinicName clinicAddress phoneNumber consultationFee profileIcon availability bio')
    .sort({ firstName: 1, lastName: 1 })
    .lean();

  const mapped = pediatricians.map((p) => {
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
      matchScore: match.score,
      suggestedReason: match.reason,
      isSuggested: context.consultationNeeded ? match.score > 0 : false,
    };
  });

  mapped.sort((a, b) => (b.matchScore - a.matchScore) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

  return {
    context: {
      hasAssessment: context.hasAssessment,
      consultationNeeded: context.consultationNeeded,
      urgent: context.urgent,
      focusAreas: context.focusAreas.map((a) => a.label),
      summary: context.summary,
      assessmentId: latest?.assessment ? String(latest.assessment._id) : null,
    },
    pediatricians: mapped,
  };
}

async function hydrateAppointment(appointmentDoc) {
  const [child, parent, pediatrician] = await Promise.all([
    Child.findById(appointmentDoc.childId).lean(),
    User.findById(appointmentDoc.parentId).lean(),
    appointmentDoc.pediatricianId ? User.findById(appointmentDoc.pediatricianId).lean() : null,
  ]);

  return {
    id: appointmentDoc.id,
    childId: child ? String(child._id) : null,
    parentId: parent ? String(parent._id) : null,
    pediatricianId: pediatrician ? String(pediatrician._id) : null,
    appointmentDate: appointmentDoc.appointmentDate,
    appointmentTime: appointmentDoc.appointmentTime,
    reason: appointmentDoc.reason,
    notes: appointmentDoc.notes,
    location: appointmentDoc.location,
    status: appointmentDoc.status,
    createdAt: appointmentDoc.createdAt,
    childFirstName: child?.firstName || null,
    childLastName: child?.lastName || null,
    childName: child ? `${child.firstName} ${child.lastName}` : 'Unknown Child',
    childAge: child ? calcAge(child.dateOfBirth) : '—',
    childDob: child?.dateOfBirth || null,
    childDateOfBirth: child?.dateOfBirth || null,
    childGender: child?.gender || null,
    childProfileIcon: child?.profileIcon || null,
    parentFirstName: parent?.firstName || null,
    parentLastName: parent?.lastName || null,
    parentName: parent ? `${parent.firstName} ${parent.lastName}` : 'Unknown Parent',
    parentEmail: parent?.email || null,
    pediatricianName: pediatrician ? `${pediatrician.firstName} ${pediatrician.lastName}` : null,
    pediatricianFirstName: pediatrician?.firstName || null,
    pediatricianLastName: pediatrician?.lastName || null,
    pediatricianEmail: pediatrician?.email || null,
    pediatricianSpecialization: pediatrician?.specialization || null,
    clinicName: clinicNameFor(pediatrician),
    clinicAddress: clinicAddressFor(pediatrician),
    pediatricianPhoneNumber: pediatrician?.phoneNumber || null,
    consultationFee: pediatrician?.consultationFee ?? null,
    pedPhoto: pediatrician?.profileIcon || null,
    parentPhoto: parent?.profileIcon || null,
    hasVideo: Boolean(appointmentDoc.hasVideo),
  };
}

// GET /api/appointments/pediatricians/list
// Used by parent appointments page.
router.get('/pediatricians/list', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'parent' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Parents or admins only.' });
    }

    const childId = req.query.childId ? String(req.query.childId) : null;
    if (childId && req.user.role === 'parent') {
      const ownedChild = await Child.findOne({ _id: childId, parentId: req.user.userId }).select('_id').lean();
      if (!ownedChild) return res.status(404).json({ error: 'Child not found for this parent.' });
    }

    const built = await buildSuggestedPediatricians({ childId });
    res.json({ success: true, ...built });
  } catch (err) {
    console.error('appointments /pediatricians/list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/appointments/pedia
// Used by pediatrician appointments / dashboard / question assignment pages.
router.get('/pedia', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const docs = await Appointment.find({ pediatricianId: req.user.userId }).sort({ appointmentDate: -1, createdAt: -1 }).lean();
    const appointments = [];
    for (const doc of docs) appointments.push(await hydrateAppointment(doc));

    res.json({ success: true, appointments });
  } catch (err) {
    console.error('appointments /pedia error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/appointments/pedia-notifications
// Instead of a separate SQL table, we build the pediatrician's dashboard request list
// from appointments that belong to that pediatrician.
router.get('/pedia-notifications', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const docs = await Appointment.find({ pediatricianId: req.user.userId }).sort({ createdAt: -1 }).lean();
    const notifications = [];
    for (const doc of docs) {
      const appt = await hydrateAppointment(doc);
      notifications.push({
        id: appt.id, // keep numeric id so the current frontend onclick works
        appointmentId: appt.id,
        pediatricianId: appt.pediatricianId,
        parentName: appt.parentName,
        childName: appt.childName,
        appointmentDate: appt.appointmentDate,
        appointmentTime: appt.appointmentTime,
        reason: appt.reason,
        hasVideo: appt.hasVideo,
        status: appt.status,
        appointmentStatus: appt.status,
        createdAt: doc.createdAt,
      });
    }

    res.json({ success: true, notifications });
  } catch (err) {
    console.error('appointments /pedia-notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/appointments/create
// Parent books a new appointment.
router.post('/create', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ error: 'Parents only.' });
    }

    const { childId, pediatricianId, appointmentDate, appointmentTime, reason, notes, location } = req.body;

    if (!childId || !pediatricianId || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ error: 'Child, pediatrician, date, and time are required.' });
    }

    const [child, parent, pediatrician] = await Promise.all([
      Child.findOne({ _id: childId, parentId: req.user.userId }),
      User.findById(req.user.userId),
      User.findOne({ _id: pediatricianId, role: 'pediatrician', status: 'active' }),
    ]);

    if (!child) return res.status(404).json({ error: 'Child not found for this parent.' });
    if (!parent) return res.status(404).json({ error: 'Parent account not found.' });
    if (!pediatrician) return res.status(404).json({ error: 'Selected pediatrician not found.' });

    // Enforce the pediatrician's saved schedule and daily limit from Settings.
    const apptDate = new Date(`${appointmentDate}T00:00:00.000Z`);
    const dayName = apptDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const availableDays = Array.isArray(pediatrician.availability?.days) ? pediatrician.availability.days : [];
    const startTime = pediatrician.availability?.startTime || null;
    const endTime = pediatrician.availability?.endTime || null;
    const maxPatientsPerDay = Number(pediatrician.availability?.maxPatientsPerDay || 10);

    if (availableDays.length && !availableDays.includes(dayName)) {
      return res.status(400).json({ error: `Dr. ${pediatrician.firstName} ${pediatrician.lastName} is not available on ${dayName}.` });
    }

    const toMinutes = (value) => {
      const [h, m] = String(value || '').split(':');
      const hh = parseInt(h, 10);
      const mm = parseInt(m || '0', 10);
      if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
      return hh * 60 + mm;
    };

    const requestedMinutes = toMinutes(appointmentTime);
    const startMinutes = toMinutes(startTime);
    const endMinutes = toMinutes(endTime);
    if (requestedMinutes != null && startMinutes != null && endMinutes != null) {
      if (requestedMinutes < startMinutes || requestedMinutes > endMinutes) {
        return res.status(400).json({ error: `Please choose a time between ${fmtTime(startTime)} and ${fmtTime(endTime)}.` });
      }
    }

    const nextDay = new Date(apptDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const bookedCount = await Appointment.countDocuments({
      pediatricianId: pediatrician._id,
      appointmentDate: { $gte: apptDate, $lt: nextDay },
      status: { $in: ['pending', 'approved'] },
    });
    if (bookedCount >= maxPatientsPerDay) {
      return res.status(400).json({ error: `Dr. ${pediatrician.firstName} ${pediatrician.lastName} already reached the maximum patients for ${fmtDate(apptDate)}.` });
    }

    const appt = await Appointment.create({
      childId: child._id,
      parentId: parent._id,
      pediatricianId: pediatrician._id,
      appointmentDate: apptDate,
      appointmentTime,
      reason: reason || 'General checkup',
      notes: notes || null,
      location: location || pediatrician.clinicAddress || pediatrician.clinicName || pediatrician.institution || null,
      status: 'pending',
    });

    const childName = `${child.firstName} ${child.lastName}`;
    const parentName = `${parent.firstName} ${parent.lastName}`;
    const dateStr = fmtDate(appt.appointmentDate);
    const timeStr = fmtTime(appt.appointmentTime);

    await pushNotification(
      pediatrician._id,
      'New Appointment Request',
      `${parentName} requested an appointment for ${childName} on ${dateStr} at ${timeStr}.`,
      'appointment'
    );

    await sendEmail(
      pediatrician.email,
      `New Appointment Request — ${childName}`,
      `<h2>New Appointment Request</h2>
       <p>Hello Dr. ${pediatrician.firstName} ${pediatrician.lastName},</p>
       <div style="background:white;border-left:4px solid #6B8E6F;padding:16px;border-radius:6px;margin:16px 0;">
         <p><strong>Patient:</strong> ${childName}</p>
         <p><strong>Parent:</strong> ${parentName}</p>
         <p><strong>Date:</strong> ${dateStr}</p>
         <p><strong>Time:</strong> ${timeStr}</p>
         <p><strong>Reason:</strong> ${reason || 'General checkup'}</p>
         ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
       </div>
       <p>Log in to KinderCura to approve or decline this request.</p>`
    );

    res.status(201).json({ success: true, appointmentId: appt.id });
  } catch (err) {
    console.error('appointments create error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function updateAppointmentStatusById({ appointmentId, status, notes = null }) {
  const appt = await Appointment.findOne({ id: Number(appointmentId) });
  if (!appt) throw new Error('Appointment not found.');

  if (notes != null && String(notes).trim()) appt.notes = String(notes).trim();
  appt.status = status;
  await appt.save();

  const hydrated = await hydrateAppointment(appt.toObject());
  const labelMap = { approved: 'Approved', rejected: 'Rejected', completed: 'Completed', cancelled: 'Cancelled' };
  const label = labelMap[status] || status;
  const pedName = hydrated.pediatricianName ? `Dr. ${hydrated.pediatricianName}` : 'Your Pediatrician';
  const dateStr = fmtDate(hydrated.appointmentDate);
  const timeStr = fmtTime(hydrated.appointmentTime);

  await pushNotification(
    hydrated.parentId,
    `Appointment ${label}`,
    `Your appointment with ${pedName} for ${hydrated.childName} on ${dateStr} at ${timeStr} has been ${label}.`,
    'appointment'
  );

  await sendEmail(
    hydrated.parentEmail,
    `Appointment ${label} — KinderCura`,
    `<h2>Appointment Status Update</h2>
     <p>Hello ${hydrated.parentFirstName || 'Parent'},</p>
     <div style="background:white;border-left:4px solid #6B8E6F;padding:16px;border-radius:6px;margin:16px 0;">
       <p><strong>Patient:</strong> ${hydrated.childName}</p>
       <p><strong>Pediatrician:</strong> ${pedName}</p>
       <p><strong>Date:</strong> ${dateStr}</p>
       <p><strong>Time:</strong> ${timeStr}</p>
       <p><strong>Status:</strong> ${label}</p>
       ${hydrated.reason ? `<p><strong>Reason:</strong> ${hydrated.reason}</p>` : ''}
       ${hydrated.notes ? `<p><strong>Note:</strong> ${hydrated.notes}</p>` : ''}
     </div>
     <p>Please check KinderCura for the latest update.</p>`
  );

  return hydrated;
}

// PUT /api/appointments/:appointmentId/status
router.put('/:appointmentId/status', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const { status, notes } = req.body;
    const valid = ['approved', 'rejected', 'completed', 'cancelled'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });
    }

    const appt = await Appointment.findOne({ id: Number(req.params.appointmentId), pediatricianId: req.user.userId });
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    await updateAppointmentStatusById({ appointmentId: appt.id, status, notes });
    res.json({ success: true });
  } catch (err) {
    console.error('appointments status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/appointments/pedia-notifications/:id
// Frontend passes the numeric appointment id here.
router.put('/pedia-notifications/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const incoming = req.body.status;
    if (!['approved', 'declined'].includes(incoming)) {
      return res.status(400).json({ error: 'Status must be approved or declined.' });
    }

    const appt = await Appointment.findOne({ id: Number(req.params.id), pediatricianId: req.user.userId });
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    const finalStatus = incoming === 'declined' ? 'rejected' : 'approved';
    await updateAppointmentStatusById({ appointmentId: appt.id, status: finalStatus });

    res.json({ success: true, status: incoming });
  } catch (err) {
    console.error('appointments pedia-notifications update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/appointments/:appointmentId/cancel
router.post('/:appointmentId/cancel', authMiddleware, async (req, res) => {
  try {
    const appt = await Appointment.findOne({ id: Number(req.params.appointmentId) });
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    const isOwner = String(appt.parentId) === String(req.user.userId) || String(appt.pediatricianId) === String(req.user.userId);
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    await updateAppointmentStatusById({ appointmentId: appt.id, status: 'cancelled' });
    res.json({ success: true });
  } catch (err) {
    console.error('appointments cancel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/appointments/:appointmentId/reschedule
router.post('/:appointmentId/reschedule', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const { newDate, newTime, reason, note } = req.body;
    if (!newDate || !newTime) {
      return res.status(400).json({ error: 'New date and time are required.' });
    }

    const appt = await Appointment.findOne({ id: Number(req.params.appointmentId), pediatricianId: req.user.userId });
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    appt.appointmentDate = new Date(`${newDate}T00:00:00.000Z`);
    appt.appointmentTime = newTime;
    appt.status = 'approved';
    if (note && String(note).trim()) appt.notes = String(note).trim();
    await appt.save();

    const hydrated = await hydrateAppointment(appt.toObject());
    await pushNotification(
      hydrated.parentId,
      'Appointment Rescheduled',
      `Your appointment for ${hydrated.childName} was moved to ${fmtDate(appt.appointmentDate)} at ${fmtTime(appt.appointmentTime)}.`,
      'appointment'
    );

    await sendEmail(
      hydrated.parentEmail,
      'Appointment Rescheduled — KinderCura',
      `<h2>Appointment Rescheduled</h2>
       <p>Hello ${hydrated.parentFirstName || 'Parent'},</p>
       <div style="background:white;border-left:4px solid #6B8E6F;padding:16px;border-radius:6px;margin:16px 0;">
         <p><strong>Patient:</strong> ${hydrated.childName}</p>
         <p><strong>New Date:</strong> ${fmtDate(appt.appointmentDate)}</p>
         <p><strong>New Time:</strong> ${fmtTime(appt.appointmentTime)}</p>
         ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
         ${note ? `<p><strong>Note:</strong> ${note}</p>` : ''}
       </div>`
    );

    res.json({ success: true });
  } catch (err) {
    console.error('appointments reschedule error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/appointments/:userId
// Parent appointment history list.
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const sameUser = String(req.user.userId) === String(req.params.userId);
    if (!sameUser && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const docs = await Appointment.find({ parentId: req.params.userId }).sort({ appointmentDate: -1, createdAt: -1 }).lean();
    const appointments = [];
    for (const doc of docs) appointments.push(await hydrateAppointment(doc));

    res.json({ success: true, appointments });
  } catch (err) {
    console.error('appointments history error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Optional general update endpoint still used in some older code.
router.put('/:appointmentId', authMiddleware, async (req, res) => {
  try {
    const appt = await Appointment.findOne({ id: Number(req.params.appointmentId) });
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    const isOwner = String(appt.parentId) === String(req.user.userId) || String(appt.pediatricianId) === String(req.user.userId);
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const { status, notes } = req.body;
    if (status) appt.status = status;
    if (notes !== undefined) appt.notes = notes;
    await appt.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:appointmentId', authMiddleware, async (req, res) => {
  try {
    const appt = await Appointment.findOne({ id: Number(req.params.appointmentId) });
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
    await Appointment.deleteOne({ _id: appt._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
