const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ── Email transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const emailConfigured = () =>
    process.env.EMAIL_USER &&
    process.env.EMAIL_USER !== 'your_email@gmail.com' &&
    process.env.EMAIL_PASS &&
    process.env.EMAIL_PASS !== 'your_gmail_app_password';

function emailStyle(content) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:#6B8E6F;padding:20px;text-align:center;border-radius:10px 10px 0 0;">
            <h1 style="color:white;margin:0;font-size:1.4rem;">
                <span style="color:#E8A5A5;">Kinder</span><span style="color:white;">Cura</span>
            </h1>
        </div>
        <div style="background:#f9f9f9;padding:28px;border-radius:0 0 10px 10px;">
            ${content}
        </div>
        <p style="text-align:center;color:#aaa;font-size:0.78rem;margin-top:12px;">
            KinderCura — Supporting Your Child's Development Journey
        </p>
    </div>`;
}

async function sendEmail(to, subject, htmlContent) {
    if (!emailConfigured()) {
        console.log(`\n📧 EMAIL NOT CONFIGURED — Would send to ${to}: ${subject}\n`);
        return;
    }
    try {
        await transporter.sendMail({
            from: `"KinderCura" <${process.env.EMAIL_USER}>`,
            to, subject,
            html: emailStyle(htmlContent)
        });
    } catch (e) {
        console.error('Email send error:', e.message);
    }
}

// ── GET /api/appointments/pediatricians/list ──────────────────────────────────
router.get('/pediatricians/list', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(
            "SELECT id,firstName,lastName,specialization,institution FROM users WHERE role='pediatrician' AND status='active'"
        );
        res.json({ success: true, pediatricians: result.recordset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/appointments/create ─────────────────────────────────────────────
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const { childId, pediatricianId, appointmentDate, appointmentTime, reason, notes, location } = req.body;
        if (!childId || !appointmentDate || !appointmentTime)
            return res.status(400).json({ error: 'Child, date, and time are required.' });

        const pool = await poolPromise;

        // Create appointment
        const result = await pool.request()
            .input('childId',         sql.Int,      childId)
            .input('parentId',        sql.Int,      req.user.userId)
            .input('pediatricianId',  sql.Int,      pediatricianId || null)
            .input('appointmentDate', sql.Date,     appointmentDate)
            .input('appointmentTime', sql.NVarChar, appointmentTime)
            .input('reason',          sql.NVarChar, reason || null)
            .input('notes',           sql.NVarChar, notes  || null)
            .input('location',        sql.NVarChar, location || null)
            .query(`INSERT INTO appointments (childId,parentId,pediatricianId,appointmentDate,appointmentTime,reason,notes,location)
                    OUTPUT INSERTED.id
                    VALUES (@childId,@parentId,@pediatricianId,@appointmentDate,@appointmentTime,@reason,@notes,@location)`);

        const appointmentId = result.recordset[0].id;

        if (pediatricianId) {
            // Fetch parent, child, and pedia info
            const parentInfo = await pool.request()
                .input('id', sql.Int, req.user.userId)
                .query('SELECT firstName, lastName, email FROM users WHERE id=@id');
            const childInfo = await pool.request()
                .input('id', sql.Int, childId)
                .query('SELECT firstName, lastName FROM children WHERE id=@id');
            const pedInfo = await pool.request()
                .input('id', sql.Int, pediatricianId)
                .query('SELECT firstName, lastName, email FROM users WHERE id=@id');

            const parent = parentInfo.recordset[0];
            const child  = childInfo.recordset[0];
            const pedia  = pedInfo.recordset[0];

            // Insert pedia_notification row
            await pool.request()
                .input('pediatricianId',  sql.Int,      pediatricianId)
                .input('appointmentId',   sql.Int,      appointmentId)
                .input('parentName',      sql.NVarChar, `${parent.firstName} ${parent.lastName}`)
                .input('childName',       sql.NVarChar, `${child.firstName} ${child.lastName}`)
                .input('appointmentDate', sql.Date,     appointmentDate)
                .input('appointmentTime', sql.NVarChar, appointmentTime)
                .input('reason',          sql.NVarChar, reason || 'General checkup')
                .query(`INSERT INTO pedia_notifications
                        (pediatricianId,appointmentId,parentName,childName,appointmentDate,appointmentTime,reason)
                        VALUES (@pediatricianId,@appointmentId,@parentName,@childName,@appointmentDate,@appointmentTime,@reason)`);

            // ── Email to pediatrician ─────────────────────────────────────────
            await sendEmail(
                pedia.email,
                `New Appointment Request — ${child.firstName} ${child.lastName}`,
                `<h2 style="color:#333;">New Appointment Request 📅</h2>
                 <p style="color:#555;">Hello Dr. ${pedia.firstName} ${pedia.lastName},</p>
                 <p style="color:#555;">You have received a new appointment request:</p>
                 <div style="background:white;border-left:4px solid #6B8E6F;padding:16px;border-radius:6px;margin:16px 0;">
                     <p style="margin:4px 0;"><strong>Patient:</strong> ${child.firstName} ${child.lastName}</p>
                     <p style="margin:4px 0;"><strong>Parent/Guardian:</strong> ${parent.firstName} ${parent.lastName}</p>
                     <p style="margin:4px 0;"><strong>Date:</strong> ${appointmentDate}</p>
                     <p style="margin:4px 0;"><strong>Time:</strong> ${appointmentTime}</p>
                     <p style="margin:4px 0;"><strong>Reason:</strong> ${reason || 'General checkup'}</p>
                     ${notes ? `<p style="margin:4px 0;"><strong>Notes:</strong> ${notes}</p>` : ''}
                 </div>
                 <p style="color:#555;">Please log in to KinderCura to <strong>approve or decline</strong> this request.</p>`
            );
        }

        res.status(201).json({ success: true, appointmentId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/appointments/pedia-notifications ─────────────────────────────────
router.get('/pedia-notifications', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('pedId', sql.Int, req.user.userId)
            .query(`SELECT pn.*,
                           ar.communicationScore, ar.socialScore, ar.cognitiveScore, ar.motorScore, ar.overallScore,
                           ar.communicationStatus, ar.socialStatus, ar.cognitiveStatus, ar.motorStatus, ar.riskFlags
                    FROM   pedia_notifications pn
                    LEFT JOIN appointments a     ON pn.appointmentId = a.id
                    LEFT JOIN children c         ON a.childId = c.id
                    LEFT JOIN assessment_results ar ON c.id = ar.childId
                    WHERE  pn.pediatricianId = @pedId
                    ORDER  BY pn.createdAt DESC`);
        res.json({ success: true, notifications: result.recordset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/appointments/pedia-notifications/:notifId (approve / decline) ────
router.put('/pedia-notifications/:notifId', authMiddleware, async (req, res) => {
    try {
        const { status } = req.body; // 'approved' or 'declined'
        if (!['approved', 'declined'].includes(status))
            return res.status(400).json({ error: 'Status must be approved or declined.' });

        const pool = await poolPromise;

        // Update notification status
        await pool.request()
            .input('id',     sql.Int,      req.params.notifId)
            .input('status', sql.NVarChar, status)
            .query('UPDATE pedia_notifications SET status=@status, isRead=1 WHERE id=@id');

        // Get notification details (for email + appointment update)
        const notifResult = await pool.request()
            .input('id', sql.Int, req.params.notifId)
            .query(`SELECT pn.*, a.parentId, a.appointmentDate, a.appointmentTime, a.reason,
                           u.firstName AS pedFirst, u.lastName AS pedLast,
                           pu.email AS parentEmail, pu.firstName AS parentFirst, pu.lastName AS parentLast
                    FROM   pedia_notifications pn
                    JOIN   appointments a ON pn.appointmentId = a.id
                    JOIN   users u  ON pn.pediatricianId = u.id
                    JOIN   users pu ON a.parentId = pu.id
                    WHERE  pn.id = @id`);

        if (notifResult.recordset.length > 0) {
            const n = notifResult.recordset[0];

            // Update appointment status
            await pool.request()
                .input('apptId', sql.Int,      n.appointmentId)
                .input('status', sql.NVarChar, status)
                .query('UPDATE appointments SET status=@status WHERE id=@apptId');

            // ── Email to parent ───────────────────────────────────────────────
            const statusLabel = status === 'approved' ? '✅ Approved' : '❌ Declined';
            const statusColor = status === 'approved' ? '#27ae60' : '#e74c3c';

            await sendEmail(
                n.parentEmail,
                `Appointment ${status === 'approved' ? 'Approved' : 'Declined'} — KinderCura`,
                `<h2 style="color:#333;">Appointment Update</h2>
                 <p style="color:#555;">Hello ${n.parentFirst},</p>
                 <p style="color:#555;">Your appointment request has been
                     <strong style="color:${statusColor};">${statusLabel}</strong>
                 by Dr. ${n.pedFirst} ${n.pedLast}.</p>
                 <div style="background:white;border-left:4px solid ${statusColor};padding:16px;border-radius:6px;margin:16px 0;">
                     <p style="margin:4px 0;"><strong>Patient:</strong> ${n.childName}</p>
                     <p style="margin:4px 0;"><strong>Pediatrician:</strong> Dr. ${n.pedFirst} ${n.pedLast}</p>
                     <p style="margin:4px 0;"><strong>Date:</strong> ${n.appointmentDate}</p>
                     <p style="margin:4px 0;"><strong>Time:</strong> ${n.appointmentTime}</p>
                     <p style="margin:4px 0;"><strong>Reason:</strong> ${n.reason || 'General checkup'}</p>
                 </div>
                 ${status === 'approved'
                     ? `<p style="color:#555;">Please be on time for your appointment. If you need to reschedule, contact us through the KinderCura app.</p>`
                     : `<p style="color:#555;">You may book another appointment with a different schedule or pediatrician through the KinderCura app.</p>`
                 }`
            );
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/appointments/:userId (parent's appointment history) ───────────────
router.get('/:userId', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('parentId', sql.Int, req.params.userId)
            .query(`SELECT a.*,
                           c.firstName+' '+c.lastName AS childName,
                           u.firstName+' '+u.lastName AS pediatricianName,
                           u.specialization AS pediatricianSpecialization
                    FROM   appointments a
                    LEFT JOIN children c ON a.childId  = c.id
                    LEFT JOIN users    u ON a.pediatricianId = u.id
                    WHERE  a.parentId = @parentId
                    ORDER  BY a.appointmentDate DESC`);
        res.json({ success: true, appointments: result.recordset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/appointments/:appointmentId ──────────────────────────────────────
router.put('/:appointmentId', authMiddleware, async (req, res) => {
    try {
        const { status, notes } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('appointmentId', sql.Int,      req.params.appointmentId)
            .input('status',        sql.NVarChar, status || null)
            .input('notes',         sql.NVarChar, notes  || null)
            .query('UPDATE appointments SET status=COALESCE(@status,status),notes=COALESCE(@notes,notes) WHERE id=@appointmentId');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/appointments/:appointmentId ───────────────────────────────────
router.delete('/:appointmentId', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('appointmentId', sql.Int, req.params.appointmentId)
            .query('DELETE FROM appointments WHERE id=@appointmentId');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
