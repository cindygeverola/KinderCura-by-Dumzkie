const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { sql, poolPromise } = require('../db');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || !email.trim()) {
            return res.status(400).json({ error: 'Email is required.' });
        }

        const cleanEmail = email.trim().toLowerCase();

        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        const pool = await poolPromise;

        const existingUser = await pool.request()
            .input('email', sql.NVarChar, cleanEmail)
            .query('SELECT id FROM users WHERE email = @email');

        if (existingUser.recordset.length > 0) {
            return res.status(409).json({ error: 'Email already in use.' });
        }

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Remove old unused OTPs for this email first
        await pool.request()
            .input('email', sql.NVarChar, cleanEmail)
            .query('DELETE FROM otp_codes WHERE email = @email AND used = 0');

        await pool.request()
            .input('email', sql.NVarChar, cleanEmail)
            .input('code', sql.NVarChar, otp)
            .input('expiresAt', sql.DateTime, expiresAt)
            .query(`
                INSERT INTO otp_codes (email, code, expiresAt, used)
                VALUES (@email, @code, @expiresAt, 0)
            `);

        const emailConfigured = process.env.EMAIL_USER &&
            process.env.EMAIL_USER !== 'your_email@gmail.com' &&
            process.env.EMAIL_PASS &&
            process.env.EMAIL_PASS !== 'your_gmail_app_password';

        if (emailConfigured) {
            await transporter.sendMail({
                from: `"KinderCura" <${process.env.EMAIL_USER}>`,
                to: cleanEmail,
                subject: 'KinderCura — Email Verification Code',
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
                        <div style="background:#6B8E6F;padding:20px;text-align:center;border-radius:10px 10px 0 0;">
                            <h1 style="color:white;margin:0;">KinderCura</h1>
                        </div>
                        <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
                            <h2 style="color:#333;">Email Verification</h2>
                            <p style="color:#666;">Use the code below to verify your email. It expires in <strong>10 minutes</strong>.</p>
                            <div style="background:white;border:2px dashed #6B8E6F;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">
                                <span style="font-size:2.5rem;font-weight:bold;letter-spacing:10px;color:#6B8E6F;">${otp}</span>
                            </div>
                            <p style="color:#999;font-size:0.85rem;">If you did not request this, please ignore this email.</p>
                        </div>
                    </div>
                `
            });
            console.log(`📧 OTP sent to ${cleanEmail}`);
        } else {
            // Email not configured — show OTP in server console for testing
            console.log(`\n⚠️  EMAIL NOT CONFIGURED — OTP for ${cleanEmail}: ${otp}\n`);
        }

        res.json({
            success: true,
            message: emailConfigured
                ? 'OTP sent to your email.'
                : `OTP generated (check server console): ${otp}`,
            // Remove devOtp in production
            devOtp: emailConfigured ? undefined : otp
        });

    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({
            error: 'Failed to send OTP. Please check email configuration.'
        });
    }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and OTP are required.' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanCode = String(code).trim();

        if (cleanCode.length !== 4) {
            return res.status(400).json({ error: 'OTP must be 4 digits.' });
        }

        const pool = await poolPromise;

        const result = await pool.request()
            .input('email', sql.NVarChar, cleanEmail)
            .input('code', sql.NVarChar, cleanCode)
            .query(`
                SELECT TOP 1 *
                FROM otp_codes
                WHERE email = @email
                  AND code = @code
                  AND used = 0
                ORDER BY createdAt DESC
            `);

        if (result.recordset.length === 0) {
            return res.status(400).json({ error: 'Invalid OTP.' });
        }

        const otpRow = result.recordset[0];
        const now = new Date();
        const expiry = new Date(otpRow.expiresAt);

        if (now > expiry) {
            return res.status(400).json({ error: 'OTP expired.' });
        }

        await pool.request()
            .input('id', sql.Int, otpRow.id)
            .query('UPDATE otp_codes SET used = 1 WHERE id = @id');

        res.json({
            success: true,
            message: 'Email verified!'
        });

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
            organization,
            department,
            childFirstName,
            childLastName,
            childMiddleName,
            dateOfBirth,
            gender,
            relationship,
            childProfileIcon
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

        if (!['parent', 'pediatrician', 'admin'].includes(cleanRole)) {
            return res.status(400).json({ error: 'Invalid user role.' });
        }

        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        if (cleanPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        }

        const pool = await poolPromise;

        const exists = await pool.request()
            .input('email', sql.NVarChar, cleanEmail)
            .input('username', sql.NVarChar, cleanUsername)
            .query(`
                SELECT id
                FROM users
                WHERE email = @email OR username = @username
            `);

        if (exists.recordset.length > 0) {
            return res.status(409).json({ error: 'Email or username already in use.' });
        }

        // Require verified OTP before register
        const verifiedOtp = await pool.request()
            .input('email', sql.NVarChar, cleanEmail)
            .query(`
                SELECT TOP 1 id
                FROM otp_codes
                WHERE email = @email
                  AND used = 1
                ORDER BY createdAt DESC
            `);

        if (verifiedOtp.recordset.length === 0) {
            return res.status(400).json({ error: 'Please verify your email first.' });
        }

        const passwordHash = await bcrypt.hash(cleanPassword, 10);

        const insertUser = await pool.request()
            .input('firstName', sql.NVarChar, cleanFirstName)
            .input('middleName', sql.NVarChar, cleanMiddleName || null)
            .input('lastName', sql.NVarChar, cleanLastName)
            .input('username', sql.NVarChar, cleanUsername)
            .input('email', sql.NVarChar, cleanEmail)
            .input('passwordHash', sql.NVarChar, passwordHash)
            .input('role', sql.NVarChar, cleanRole)
            .input('status', sql.NVarChar, 'active')
            .input('emailVerified', sql.Bit, 1)
            .input('profileIcon', sql.NVarChar, profileIcon || 'avatar1')
            .input('licenseNumber', sql.NVarChar, licenseNumber || null)
            .input('institution', sql.NVarChar, institution || null)
            .input('specialization', sql.NVarChar, specialization || null)
            .input('organization', sql.NVarChar, organization || null)
            .input('department', sql.NVarChar, department || null)
            .query(`
                INSERT INTO users
                (
                    firstName, middleName, lastName, username, email, passwordHash,
                    role, status, emailVerified, profileIcon, licenseNumber,
                    institution, specialization, organization, department
                )
                OUTPUT INSERTED.id
                VALUES
                (
                    @firstName, @middleName, @lastName, @username, @email, @passwordHash,
                    @role, @status, @emailVerified, @profileIcon, @licenseNumber,
                    @institution, @specialization, @organization, @department
                )
            `);

        const userId = insertUser.recordset[0].id;
        let childId = null;

        if (cleanRole === 'parent' && childFirstName && childLastName && dateOfBirth) {
            const childResult = await pool.request()
                .input('parentId', sql.Int, userId)
                .input('firstName', sql.NVarChar, String(childFirstName).trim())
                .input('middleName', sql.NVarChar, childMiddleName ? String(childMiddleName).trim() : null)
                .input('lastName', sql.NVarChar, String(childLastName).trim())
                .input('dateOfBirth', sql.Date, dateOfBirth)
                .input('gender', sql.NVarChar, gender || null)
                .input('relationship', sql.NVarChar, relationship || null)
                .input('profileIcon', sql.NVarChar, childProfileIcon || 'child1')
                .query(`
                    INSERT INTO children
                    (parentId, firstName, middleName, lastName, dateOfBirth, gender, relationship, profileIcon)
                    OUTPUT INSERTED.id
                    VALUES
                    (@parentId, @firstName, @middleName, @lastName, @dateOfBirth, @gender, @relationship, @profileIcon)
                `);

            childId = childResult.recordset[0].id;
        }

        const token = jwt.sign(
            { userId, role: cleanRole, email: cleanEmail },
            process.env.JWT_SECRET,
            { expiresIn: '48h' }
        );

        res.status(201).json({
            success: true,
            userId,
            childId,
            role: cleanRole,
            token,
            user: {
                id: userId,
                firstName: cleanFirstName,
                lastName: cleanLastName,
                email: cleanEmail,
                role: cleanRole,
                username: cleanUsername,
                profileIcon: profileIcon || 'avatar1'
            }
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
            return res.status(400).json({
                error: 'Please provide email/username and password.'
            });
        }

        const cleanEmail = email ? String(email).trim().toLowerCase() : '';
        const cleanUsername = username ? String(username).trim() : '';
        const cleanPassword = String(password);

        const pool = await poolPromise;

        const result = await pool.request()
            .input('email', sql.NVarChar, cleanEmail)
            .input('username', sql.NVarChar, cleanUsername)
            .query(`
                SELECT *
                FROM users
                WHERE email = @email OR username = @username
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: 'Invalid email/username or password.' });
        }

        const user = result.recordset[0];

        if (user.status === 'suspended') {
            return res.status(403).json({ error: 'Your account has been suspended.' });
        }

        const match = await bcrypt.compare(cleanPassword, user.passwordHash);

        if (!match) {
            return res.status(401).json({ error: 'Invalid email/username or password.' });
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '48h' }
        );

        // Fetch first child ID for parent users so the client can cache it immediately
        let childId = null;
        if (user.role === 'parent') {
            try {
                const childResult = await pool.request()
                    .input('parentId', sql.Int, user.id)
                    .query('SELECT TOP 1 id FROM children WHERE parentId = @parentId ORDER BY createdAt DESC');
                if (childResult.recordset.length > 0) {
                    childId = childResult.recordset[0].id;
                }
            } catch (childErr) {
                console.warn('Could not fetch child ID on login:', childErr.message);
            }
        }

        res.json({
            success: true,
            token,
            role: user.role,
            userId: user.id,
            childId,
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                username: user.username,
                profileIcon: user.profileIcon || 'avatar1'
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error while logging in.' });
    }
});

// GET /api/auth/me — fetch current authenticated user's fresh data
const { authMiddleware } = require('../middleware/auth');
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.user.userId)
            .query(`SELECT id, firstName, middleName, lastName, username, email, role, profileIcon,
                           licenseNumber, institution, specialization, organization, department
                    FROM users WHERE id = @id`);
        if (result.recordset.length === 0)
            return res.status(404).json({ error: 'User not found.' });
        const u = result.recordset[0];
        res.json({
            success: true,
            user: {
                id: u.id,
                firstName: u.firstName,
                middleName: u.middleName,
                lastName: u.lastName,
                username: u.username,
                email: u.email,
                role: u.role,
                profileIcon: u.profileIcon || 'avatar1',
                licenseNumber: u.licenseNumber,
                institution: u.institution,
                specialization: u.specialization,
                organization: u.organization,
                department: u.department
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/auth/update-profile — update name and/or professional info
router.put('/update-profile', authMiddleware, async (req, res) => {
    try {
        const { firstName, lastName, middleName, licenseNumber, institution, specialization, organization, department } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('id',             sql.Int,      req.user.userId)
            .input('firstName',      sql.NVarChar, firstName      || null)
            .input('lastName',       sql.NVarChar, lastName       || null)
            .input('middleName',     sql.NVarChar, middleName     || null)
            .input('licenseNumber',  sql.NVarChar, licenseNumber  || null)
            .input('institution',    sql.NVarChar, institution    || null)
            .input('specialization', sql.NVarChar, specialization || null)
            .input('organization',   sql.NVarChar, organization   || null)
            .input('department',     sql.NVarChar, department     || null)
            .query(`UPDATE users SET
                        firstName      = COALESCE(@firstName,      firstName),
                        lastName       = COALESCE(@lastName,       lastName),
                        middleName     = COALESCE(@middleName,     middleName),
                        licenseNumber  = COALESCE(@licenseNumber,  licenseNumber),
                        institution    = COALESCE(@institution,    institution),
                        specialization = COALESCE(@specialization, specialization),
                        organization   = COALESCE(@organization,   organization),
                        department     = COALESCE(@department,     department)
                    WHERE id = @id`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 8)
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        const passwordHash = await bcrypt.hash(password, 10);
        const pool = await poolPromise;
        await pool.request()
            .input('id',           sql.Int,      req.user.userId)
            .input('passwordHash', sql.NVarChar, passwordHash)
            .query('UPDATE users SET passwordHash=@passwordHash WHERE id=@id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;