// routes/auth.js
// Handles OTP, registration, login, profile updates, and pediatrician settings.
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const User = require('../models/User');
const Child = require('../models/Child');
const Assessment = require('../models/Assessment');
const OtpCode = require('../models/OtpCode');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function emailConfigured() {
  return Boolean(
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS &&
    process.env.EMAIL_USER !== 'your_email@gmail.com' &&
    process.env.EMAIL_PASS !== 'your_gmail_app_password'
  );
}

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

// signToken — creates a JWT for the logged-in user.
// Important: for secretary accounts, linkedPediatricianId MUST be included
// in the payload so that appointment routes can scope queries to the correct
// pediatrician without an extra database lookup on every request.
function signToken(user) {
  const payload = {
    userId: String(user._id),
    role: user.role,
    email: user.email,
  };

  // Only attach linkedPediatricianId for secretary accounts.
  // For all other roles this field remains absent from the token.
  if (user.role === 'secretary' && user.linkedPediatricianId) {
    payload.linkedPediatricianId = String(user.linkedPediatricianId);
  }

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '48h' });
}

// normalizeDays — validates and cleans the pediatrician's available day list.
// Only standard weekday names are accepted; anything else is stripped out.
function normalizeDays(days) {
  const valid = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  if (!Array.isArray(days)) return [];
  return days
    .map((d) => String(d || '').trim())
    .filter((d) => valid.includes(d));
}

// normalizeBreaks — validates the pediatrician's break time entries.
// Each break must have both a startTime and endTime; malformed entries are removed.
function normalizeBreaks(breaks) {
  if (!Array.isArray(breaks)) return [];
  return breaks
    .map((entry) => {
      const startTime = String(entry?.startTime || '').trim();
      const endTime = String(entry?.endTime || '').trim();
      if (!startTime || !endTime) return null;
      return {
        label: entry?.label ? String(entry.label).trim() : null,
        startTime,
        endTime,
      };
    })
    .filter(Boolean);
}


function publicUser(user) {
  return {
    id: String(user._id),
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    profileIcon: user.profileIcon || 'avatar1',
    licenseNumber: user.licenseNumber || null,
    institution: user.institution || null,
    specialization: user.specialization || null,
    clinicName: user.clinicName || null,
    clinicAddress: user.clinicAddress || null,
    phoneNumber: user.phoneNumber || null,
    consultationFee: user.consultationFee ?? null,
    bio: user.bio || null,
    organization: user.organization || null,
    department: user.department || null,
    // Important: linkedPediatricianId powers the secretary's "on behalf of Dr. X" UI.
    // It is null for all non-secretary roles.
    linkedPediatricianId: user.linkedPediatricianId
      ? String(user.linkedPediatricianId)
      : null,
    availability: {
      days: normalizeDays(user.availability?.days || []),
      startTime: user.availability?.startTime || '09:00',
      endTime: user.availability?.endTime || '17:00',
      maxPatientsPerDay: user.availability?.maxPatientsPerDay ?? 10,
      breaks: normalizeBreaks(user.availability?.breaks || []),
    },
    notificationSettings: {
      emailAppointments: Boolean(user.notificationSettings?.emailAppointments ?? true),
      inApp: Boolean(user.notificationSettings?.inApp ?? true),
      sms: Boolean(user.notificationSettings?.sms ?? false),
      assessmentCompleted: Boolean(user.notificationSettings?.assessmentCompleted ?? true),
      dailySummary: Boolean(user.notificationSettings?.dailySummary ?? false),
    },
    privacySettings: {
      showProfile: Boolean(user.privacySettings?.showProfile ?? true),
      showAvailability: Boolean(user.privacySettings?.showAvailability ?? true),
      shareRecommendations: Boolean(user.privacySettings?.shareRecommendations ?? true),
    },
  };
}

function parseNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}


async function getParentPreAssessmentState(parentId) {
  const children = await Child.find({ parentId }).sort({ createdAt: -1 }).select('_id').lean();
  const defaultChildId = children.length ? String(children[0]._id) : null;

  if (!children.length) {
    return { defaultChildId: null, needsPreAssessment: false, preAssessmentChildId: null };
  }

  // Important:
  // Treat the first completed screening as the end of the required pre-assessment flow.
  // If the parent has not completed any screening yet, send them to screening on first login.
  const completedExists = await Assessment.exists({
    childId: { $in: children.map((c) => c._id) },
    status: 'complete',
  });

  return {
    defaultChildId,
    needsPreAssessment: !completedExists,
    preAssessmentChildId: defaultChildId,
  };
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

    const existingUser = await User.findOne({ email }).select('_id').lean();
    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use.' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OtpCode.deleteMany({ email, used: false });
    await OtpCode.create({ email, code: otp, expiresAt, used: false });

    if (emailConfigured()) {
      await transporter.sendMail({
        from: `"KinderCura" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'KinderCura — Email Verification Code',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
            <div style="background:#6B8E6F;padding:20px;text-align:center;border-radius:10px 10px 0 0;">
              <h1 style="color:white;margin:0;">KinderCura</h1>
            </div>
            <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
              <h2 style="color:#333;">Email Verification</h2>
              <p style="color:#666;">Use the 4-digit code below to verify your email. It expires in <strong>10 minutes</strong>.</p>
              <div style="background:white;border:2px dashed #6B8E6F;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">
                <span style="font-size:2.5rem;font-weight:bold;letter-spacing:10px;color:#6B8E6F;">${otp}</span>
              </div>
              <p style="color:#999;font-size:0.85rem;">If you did not request this, please ignore this email.</p>
            </div>
          </div>`,
      });
    } else {
      console.log(`\n⚠️ EMAIL NOT CONFIGURED — OTP for ${email}: ${otp}\n`);
    }

    res.json({
      success: true,
      message: emailConfigured() ? 'OTP sent to your email.' : `OTP generated (check server console): ${otp}`,
      devOtp: emailConfigured() ? undefined : otp,
    });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please check email configuration.' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and OTP are required.' });
    }
    if (code.length !== 4) {
      return res.status(400).json({ error: 'OTP must be 4 digits.' });
    }

    const otpRow = await OtpCode.findOne({ email, code, used: false }).sort({ createdAt: -1 });
    if (!otpRow) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }
    if (new Date() > new Date(otpRow.expiresAt)) {
      return res.status(400).json({ error: 'OTP expired.' });
    }

    otpRow.used = true;
    await otpRow.save();

    res.json({ success: true, message: 'Email verified!' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Server error while verifying OTP.' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const {
      role,
      firstName,
      middleName,
      lastName,
      username,
      email,
      password,
      profileIcon,
      licenseNumber,
      institution,
      specialization,
      clinicName,
      clinicAddress,
      phoneNumber,
      consultationFee,
      bio,
      organization,
      department,
      childFirstName,
      childLastName,
      childMiddleName,
      dateOfBirth,
      gender,
      relationship,
      childProfileIcon,
    } = req.body;

    if (!role || !firstName || !lastName || !username || !email || !password) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    const cleanRole = String(role).trim().toLowerCase();
    const cleanFirstName = String(firstName).trim();
    const cleanMiddleName = middleName ? String(middleName).trim() : null;
    const cleanLastName = String(lastName).trim();
    const cleanUsername = String(username).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password);

    // Important: secretary accounts can only be created by the admin — not self-registered.
    if (!['parent', 'pediatrician', 'admin'].includes(cleanRole)) {
      return res.status(400).json({ error: 'Invalid user role. Secretary accounts must be created by the admin.' });
    }
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (cleanPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const existingUser = await User.findOne({
      $or: [{ email: cleanEmail }, { username: cleanUsername }],
    }).select('_id').lean();
    if (existingUser) {
      return res.status(409).json({ error: 'Email or username already in use.' });
    }

    const verifiedOtp = await OtpCode.findOne({ email: cleanEmail, used: true }).sort({ createdAt: -1 }).lean();
    if (!verifiedOtp) {
      return res.status(400).json({ error: 'Please verify your email first.' });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    // Important: pediatrician accounts are pending until admin approval.
    const initialStatus = cleanRole === 'pediatrician' ? 'pending' : 'active';

    // For pediatricians, validate that professional info is provided
    if (cleanRole === 'pediatrician') {
      if (!licenseNumber || !licenseNumber.trim()) {
        return res.status(400).json({ error: 'Professional license number is required for pediatricians.' });
      }
    }

    const user = await User.create({
      firstName: cleanFirstName,
      middleName: cleanMiddleName,
      lastName: cleanLastName,
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      role: cleanRole,
      status: initialStatus,
      emailVerified: true,
      profileIcon: profileIcon || 'avatar1',
      licenseNumber: licenseNumber || null,
      institution: institution || null,
      specialization: specialization || null,
      clinicName: clinicName || institution || null,
      clinicAddress: clinicAddress || null,
      phoneNumber: phoneNumber || null,
      consultationFee: parseNumberOrNull(consultationFee),
      bio: bio || null,
      availability: {
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        startTime: '09:00',
        endTime: '17:00',
        maxPatientsPerDay: 10,
      },
      organization: organization || null,
      department: department || null,
    });

    let child = null;
    // Child information is optional for parent registration
    if (cleanRole === 'parent' && childFirstName && childLastName && dateOfBirth) {
      child = await Child.create({
        parentId: user._id,
        firstName: String(childFirstName).trim(),
        middleName: childMiddleName ? String(childMiddleName).trim() : null,
        lastName: String(childLastName).trim(),
        dateOfBirth: new Date(dateOfBirth),
        gender: gender || null,
        relationship: relationship || null,
        profileIcon: childProfileIcon || 'child1',
      });
    }

    const token = signToken(user);

    // Parent sign-up should continue directly to the required pre-assessment only if child was created
    const needsPreAssessment = cleanRole === 'parent' && Boolean(child);
    const preAssessmentChildId = child ? String(child._id) : null;

    res.status(201).json({
      success: true,
      userId: String(user._id),
      childId: child ? String(child._id) : null,
      role: user.role,
      status: user.status,
      token,
      user: publicUser(user),
      needsPreAssessment,
      preAssessmentChildId,
      message: user.role === 'pediatrician'
        ? 'Pediatrician account created. Please wait for admin approval before logging in.'
        : (child ? 'Account created successfully. Please continue to the child pre-assessment.' : 'Account created successfully.'),
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error while registering user.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!password || (!email && !username)) {
      return res.status(400).json({ error: 'Please provide email/username and password.' });
    }

    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    const cleanUsername = username ? String(username).trim() : '';
    const cleanPassword = String(password);

    const user = await User.findOne({
      $or: [{ email: cleanEmail }, { username: cleanUsername }],
    });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email/username or password.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: user.role === 'pediatrician' ? 'Your pediatrician account is still pending admin approval.' : 'Your account is not yet active. Please contact the clinic administrator.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended.' });
    }

    const match = await bcrypt.compare(cleanPassword, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email/username or password.' });
    }

    let childId = null;
    let needsPreAssessment = false;
    let preAssessmentChildId = null;

    if (user.role === 'parent') {
      const preState = await getParentPreAssessmentState(user._id);
      childId = preState.defaultChildId;
      needsPreAssessment = preState.needsPreAssessment;
      preAssessmentChildId = preState.preAssessmentChildId;
    }

    const token = signToken(user);
    res.json({
      success: true,
      token,
      role: user.role,
      userId: String(user._id),
      childId,
      needsPreAssessment,
      preAssessmentChildId,
      user: publicUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error while logging in.' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/update-profile
router.put('/update-profile', authMiddleware, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      middleName,
      licenseNumber,
      institution,
      specialization,
      organization,
      department,
      clinicName,
      clinicAddress,
      phoneNumber,
      consultationFee,
      bio,
    } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (firstName !== undefined) user.firstName = String(firstName).trim();
    if (lastName !== undefined) user.lastName = String(lastName).trim();
    if (middleName !== undefined) user.middleName = middleName ? String(middleName).trim() : null;
    if (licenseNumber !== undefined) user.licenseNumber = licenseNumber ? String(licenseNumber).trim() : null;
    if (institution !== undefined) user.institution = institution ? String(institution).trim() : null;
    if (specialization !== undefined) user.specialization = specialization ? String(specialization).trim() : null;
    if (organization !== undefined) user.organization = organization ? String(organization).trim() : null;
    if (department !== undefined) user.department = department ? String(department).trim() : null;
    if (clinicName !== undefined) user.clinicName = clinicName ? String(clinicName).trim() : null;
    if (clinicAddress !== undefined) user.clinicAddress = clinicAddress ? String(clinicAddress).trim() : null;
    if (phoneNumber !== undefined) user.phoneNumber = phoneNumber ? String(phoneNumber).trim() : null;
    if (consultationFee !== undefined) user.consultationFee = parseNumberOrNull(consultationFee);
    if (bio !== undefined) user.bio = bio ? String(bio).trim() : null;

    await user.save();
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.passwordHash = await bcrypt.hash(String(password), 10);
    await user.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/pediatrician/settings
router.get('/pediatrician/settings', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/pediatrician/settings
router.put('/pediatrician/settings', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const {
      phoneNumber,
      consultationFee,
      bio,
      clinicName,
      clinicAddress,
      institution,
      specialization,
      email,
      availability,
      notificationSettings,
      privacySettings,
    } = req.body;

    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!isValidEmail(cleanEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      const emailUsed = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } }).select('_id').lean();
      if (emailUsed) {
        return res.status(409).json({ error: 'That email address is already in use.' });
      }
      user.email = cleanEmail;
    }

    if (phoneNumber !== undefined) user.phoneNumber = phoneNumber ? String(phoneNumber).trim() : null;
    if (consultationFee !== undefined) user.consultationFee = parseNumberOrNull(consultationFee);
    if (bio !== undefined) user.bio = bio ? String(bio).trim() : null;
    if (clinicName !== undefined) user.clinicName = clinicName ? String(clinicName).trim() : null;
    if (clinicAddress !== undefined) user.clinicAddress = clinicAddress ? String(clinicAddress).trim() : null;
    if (institution !== undefined) user.institution = institution ? String(institution).trim() : null;
    if (specialization !== undefined) user.specialization = specialization ? String(specialization).trim() : null;

    // Save availability in one place so appointments can enforce it later.
    if (availability && typeof availability === 'object') {
      const startTime = String(availability.startTime || '09:00');
      const endTime = String(availability.endTime || '17:00');
      const days = normalizeDays(availability.days || []);
      const maxPatientsPerDay = parseNumberOrNull(availability.maxPatientsPerDay) ?? 10;

      if (!days.length) {
        return res.status(400).json({ error: 'Please select at least one available day.' });
      }
      user.availability = {
        days,
        startTime,
        endTime,
        maxPatientsPerDay: Math.max(1, Math.min(50, maxPatientsPerDay)),
        // Preserve existing breaks when this settings form only updates days/hours.
        breaks: normalizeBreaks(
          availability.breaks !== undefined
            ? availability.breaks
            : (user.availability?.breaks || [])
        ),
      };
    }

    if (notificationSettings && typeof notificationSettings === 'object') {
      user.notificationSettings = {
        emailAppointments: Boolean(notificationSettings.emailAppointments),
        inApp: Boolean(notificationSettings.inApp),
        sms: Boolean(notificationSettings.sms),
        assessmentCompleted: Boolean(notificationSettings.assessmentCompleted),
        dailySummary: Boolean(notificationSettings.dailySummary),
      };
    }

    if (privacySettings && typeof privacySettings === 'object') {
      user.privacySettings = {
        showProfile: Boolean(privacySettings.showProfile),
        showAvailability: Boolean(privacySettings.showAvailability),
        shareRecommendations: Boolean(privacySettings.shareRecommendations),
      };
    }

    await user.save();
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
