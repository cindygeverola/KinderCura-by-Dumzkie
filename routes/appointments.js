// routes/appointments.js
// MongoDB replacement for parent + pediatrician appointment features.
// NOTE: This file does not open MongoDB by itself.
// It uses the mongoose connection that server.js starts through db.js.
const express = require('express');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
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

function resolveNotificationModel() {
  if (!Notification) return null;
  if (typeof Notification.create === 'function') return Notification;
  if (Notification.default && typeof Notification.default.create === 'function') return Notification.default;
  if (Notification.Notification && typeof Notification.Notification.create === 'function') return Notification.Notification;
  return null;
}

async function nextNotificationId() {
  try {
    const counters = mongoose.connection.collection('counters');
    const result = await counters.findOneAndUpdate(
      { _id: 'notifications' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    if (result?.value?.seq != null) return result.value.seq;

    const doc = await counters.findOne({ _id: 'notifications' });
    if (doc?.seq != null) return doc.seq;
  } catch (err) {
    console.warn('Notification counter fallback error:', err.message);
  }

  return Date.now();
}

// Important: notification problems must never block booking / approval / reschedule.
async function pushNotification(userId, title, message, type = 'appointment') {
  const notificationModel = resolveNotificationModel();
  const payload = {
    userId: new mongoose.Types.ObjectId(String(userId)),
    title,
    message,
    type,
    isRead: false,
  };

  try {
    if (notificationModel) {
      await notificationModel.create(payload);
      return;
    }
  } catch (err) {
    console.warn('Notification model create failed, using collection fallback:', err.message);
  }

  try {
    const notifications = mongoose.connection.collection('notifications');
    await notifications.insertOne({
      ...payload,
      id: await nextNotificationId(),
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn('Notification insert fallback failed:', err.message);
  }
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

// Availability can be stored in slightly different shapes depending on which
// settings screen saved it. This normalizer keeps parent booking synced with
// the pediatrician's real saved schedule.
function normalizeAvailability(source = {}) {
  const nested = source.availability || source.scheduleAvailability || source.schedule || {};

  const dayCandidates = nested.days || nested.availableDays || nested.daysAvailable || source.availableDays || source.availabilityDays || source.daysAvailable || source.days || [];
  const days = Array.isArray(dayCandidates) ? dayCandidates.filter(Boolean) : [];

  const startTime =
    nested.startTime || nested.from || nested.begin ||
    source.availabilityStartTime || source.startTime || source.availableFrom || source.clinicStartTime || null;

  const endTime =
    nested.endTime || nested.to || nested.finish ||
    source.availabilityEndTime || source.endTime || source.availableUntil || source.clinicEndTime || null;

  const rawMax =
    nested.maxPatientsPerDay ?? nested.maxPerDay ?? nested.dailyLimit ??
    source.maxPatientsPerDay ?? source.dailyPatientLimit ?? source.maxPerDay ?? null;

  const parsedMax = rawMax == null || rawMax === '' ? null : Math.max(1, Number(rawMax) || 0);

  return {
    days,
    startTime,
    endTime,
    maxPatientsPerDay: parsedMax,
    configured: Boolean(days.length && startTime && endTime),
  };
}

function toMinutes(value) {
  const [h, m] = String(value || '').split(':');
  const hh = parseInt(h, 10);
  const mm = parseInt(m || '0', 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function normalizeUtcDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const only = String(value).slice(0, 10);
  const d = new Date(`${only}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getTodayUtcStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
    .select('firstName lastName specialization institution clinicName clinicAddress phoneNumber consultationFee profileIcon availability bio availableDays availabilityDays daysAvailable startTime endTime maxPatientsPerDay dailyPatientLimit schedule scheduleAvailability clinicStartTime clinicEndTime availableFrom availableUntil')
    .sort({ firstName: 1, lastName: 1 })
    .lean();

  const mapped = pediatricians.map((p) => {
    const match = scorePediatricianForContext(p, context);
    const availability = normalizeAvailability(p);
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
      availability,
      availabilityConfigured: availability.configured,
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

// Important helper:
// All slot checks are centralized here so create/reschedule and the parent availability preview
// all follow the same booking rules.
async function evaluateAvailability({ pediatrician, appointmentDate, appointmentTime = null, excludeAppointmentMongoId = null }) {
  if (!pediatrician) {
    return {
      available: false,
      message: 'Selected pediatrician was not found.',
      isDayAvailable: false,
      isWithinHours: false,
      isFull: false,
      isTimeTaken: false,
      remainingSlots: 0,
      bookedCount: 0,
      bookedTimes: [],
    };
  }

  const dateOnly = normalizeUtcDate(appointmentDate);
  if (!dateOnly) {
    return {
      available: false,
      message: 'Please choose a valid appointment date.',
      isDayAvailable: false,
      isWithinHours: false,
      isFull: false,
      isTimeTaken: false,
      remainingSlots: 0,
      bookedCount: 0,
      bookedTimes: [],
    };
  }

  const normalizedAvailability = normalizeAvailability(pediatrician);
  const availableDays = normalizedAvailability.days;
  const startTime = normalizedAvailability.startTime;
  const endTime = normalizedAvailability.endTime;
  const maxPatientsPerDay = Math.max(1, Number(normalizedAvailability.maxPatientsPerDay || 10));
  const dayName = dateOnly.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

  if (!normalizedAvailability.configured) {
    return {
      available: false,
      message: 'This pediatrician has not finished setting appointment availability yet.',
      dayName,
      startTime,
      endTime,
      maxPatientsPerDay,
      isDayAvailable: false,
      isWithinHours: false,
      isFull: false,
      isTimeTaken: false,
      remainingSlots: 0,
      bookedCount: 0,
      bookedTimes: [],
    };
  }

  const isDayAvailable = availableDays.includes(dayName);

  const todayUtc = getTodayUtcStart();
  if (dateOnly < todayUtc) {
    return {
      available: false,
      message: 'Please choose today or a future date.',
      dayName,
      startTime,
      endTime,
      maxPatientsPerDay,
      isDayAvailable,
      isWithinHours: false,
      isFull: false,
      isTimeTaken: false,
      remainingSlots: 0,
      bookedCount: 0,
      bookedTimes: [],
    };
  }

  if (!isDayAvailable) {
    return {
      available: false,
      message: `This pediatrician is not available on ${dayName}. Please choose one of the available days.`,
      dayName,
      startTime,
      endTime,
      maxPatientsPerDay,
      isDayAvailable: false,
      isWithinHours: false,
      isFull: false,
      isTimeTaken: false,
      remainingSlots: maxPatientsPerDay,
      bookedCount: 0,
      bookedTimes: [],
    };
  }

  const nextDay = new Date(dateOnly);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const query = {
    pediatricianId: pediatrician._id,
    appointmentDate: { $gte: dateOnly, $lt: nextDay },
    status: { $in: ['pending', 'approved'] },
  };
  if (excludeAppointmentMongoId) {
    query._id = { $ne: excludeAppointmentMongoId };
  }

  const existing = await Appointment.find(query)
    .select('appointmentTime')
    .sort({ appointmentTime: 1 })
    .lean();

  const bookedTimes = [...new Set(existing.map((a) => String(a.appointmentTime || '')).filter(Boolean))];
  const bookedCount = existing.length;
  const remainingSlots = Math.max(maxPatientsPerDay - bookedCount, 0);
  const isFull = bookedCount >= maxPatientsPerDay;

  const requestedMinutes = appointmentTime ? toMinutes(appointmentTime) : null;
  const startMinutes = toMinutes(startTime);
  const endMinutes = toMinutes(endTime);
  const isWithinHours = requestedMinutes == null || (requestedMinutes >= startMinutes && requestedMinutes <= endMinutes);
  const isTimeTaken = Boolean(appointmentTime) && bookedTimes.includes(String(appointmentTime));

  if (!isWithinHours) {
    return {
      available: false,
      message: `Please choose a time between ${fmtTime(startTime)} and ${fmtTime(endTime)}.`,
      dayName,
      startTime,
      endTime,
      maxPatientsPerDay,
      bookedCount,
      bookedTimes,
      remainingSlots,
      isDayAvailable: true,
      isWithinHours: false,
      isFull,
      isTimeTaken,
    };
  }

  if (isTimeTaken) {
    return {
      available: false,
      message: 'This time slot is already booked. Please choose another time.',
      dayName,
      startTime,
      endTime,
      maxPatientsPerDay,
      bookedCount,
      bookedTimes,
      remainingSlots,
      isDayAvailable: true,
      isWithinHours: true,
      isFull,
      isTimeTaken: true,
    };
  }

  if (isFull) {
    return {
      available: false,
      message: `This pediatrician is already fully booked for ${fmtDate(dateOnly)}. Please choose another date.`,
      dayName,
      startTime,
      endTime,
      maxPatientsPerDay,
      bookedCount,
      bookedTimes,
      remainingSlots: 0,
      isDayAvailable: true,
      isWithinHours: true,
      isFull: true,
      isTimeTaken: false,
    };
  }

  return {
    available: true,
    message: 'Schedule is available for booking.',
    dayName,
    startTime,
    endTime,
    maxPatientsPerDay,
    bookedCount,
    bookedTimes,
    remainingSlots,
    isDayAvailable: true,
    isWithinHours: true,
    isFull: false,
    isTimeTaken: false,
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

// GET /api/appointments/availability/check
// Parent page calls this to preview live slot availability before booking.
router.get('/availability/check', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'parent' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Parents or admins only.' });
    }

    const pediatricianId = String(req.query.pediatricianId || '');
    const appointmentDate = String(req.query.date || '');
    const appointmentTime = req.query.time ? String(req.query.time) : null;

    if (!pediatricianId || !appointmentDate) {
      return res.status(400).json({ error: 'Pediatrician and date are required.' });
    }

    const pediatrician = await User.findOne({ _id: pediatricianId, role: 'pediatrician', status: 'active' }).lean();
    if (!pediatrician) {
      return res.status(404).json({ error: 'Selected pediatrician not found.' });
    }

    const summary = await evaluateAvailability({ pediatrician, appointmentDate, appointmentTime });
    res.json({
      success: true,
      availability: {
        ...summary,
        clinicName: clinicNameFor(pediatrician),
        clinicAddress: clinicAddressFor(pediatrician),
        pediatricianName: `Dr. ${pediatrician.firstName} ${pediatrician.lastName}`,
      },
    });
  } catch (err) {
    console.error('appointments availability check error:', err);
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
        id: appt.id,
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

    const availability = await evaluateAvailability({ pediatrician, appointmentDate, appointmentTime });
    if (!availability.available) {
      return res.status(400).json({ error: availability.message });
    }

    const apptDate = normalizeUtcDate(appointmentDate);
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

    const pediatrician = await User.findOne({ _id: req.user.userId, role: 'pediatrician', status: 'active' });
    if (!pediatrician) return res.status(404).json({ error: 'Pediatrician not found.' });

    const availability = await evaluateAvailability({
      pediatrician,
      appointmentDate: newDate,
      appointmentTime: newTime,
      excludeAppointmentMongoId: appt._id,
    });
    if (!availability.available) {
      return res.status(400).json({ error: availability.message });
    }

    appt.appointmentDate = normalizeUtcDate(newDate);
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
