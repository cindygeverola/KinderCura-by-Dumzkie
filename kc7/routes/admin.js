const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// GET /api/admin/dashboard
router.get('/dashboard', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;

        const users       = await pool.request().query("SELECT role, COUNT(*) AS cnt FROM users GROUP BY role");
        const children    = await pool.request().query("SELECT COUNT(*) AS cnt FROM children");
        const assessments = await pool.request().query("SELECT COUNT(*) AS cnt FROM assessments");
        const completed   = await pool.request().query("SELECT COUNT(*) AS cnt FROM assessments WHERE status='complete'");
        const activity    = await pool.request().query("SELECT TOP 10 * FROM activity_log ORDER BY createdAt DESC");

        const counts = {};
        users.recordset.forEach(r => { counts[r.role] = r.cnt; });

        res.json({
            success: true,
            totalUsers:           (counts.parent || 0) + (counts.pediatrician || 0) + (counts.admin || 0),
            parentCount:          counts.parent        || 0,
            pediatricianCount:    counts.pediatrician  || 0,
            adminCount:           counts.admin         || 0,
            childCount:           children.recordset[0].cnt,
            activeAssessments:    assessments.recordset[0].cnt,
            completedScreenings:  completed.recordset[0].cnt,
            recentActivity:       activity.recordset
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { role, status, page = 1, limit = 20 } = req.query;
        const pool = await poolPromise;

        let where = 'WHERE 1=1';
        const request = pool.request();
        if (role)   { where += ' AND role=@role';     request.input('role',   sql.NVarChar, role);   }
        if (status) { where += ' AND status=@status'; request.input('status', sql.NVarChar, status); }

        const offset = (page - 1) * limit;
        request.input('offset', sql.Int, offset);
        request.input('limit',  sql.Int, parseInt(limit));

        const result = await request.query(`
            SELECT id, firstName, lastName, username, email, role, status, createdAt,
                   licenseNumber, institution, specialization, organization, department
            FROM users ${where}
            ORDER BY createdAt DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

        const total = await pool.request().query(`SELECT COUNT(*) AS cnt FROM users ${where.replace('@role','\''+role+'\'').replace('@status','\''+status+'\'')}`);

        res.json({ success: true, users: result.recordset, total: total.recordset[0].cnt, page });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/users/approve
router.post('/users/approve', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('userId', sql.Int, userId)
            .query("UPDATE users SET status='active' WHERE id=@userId");
        res.json({ success: true, message: 'User approved.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/users/suspend
router.post('/users/suspend', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('userId', sql.Int, userId)
            .query("UPDATE users SET status='suspended' WHERE id=@userId");
        res.json({ success: true, message: 'User suspended.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM users WHERE id=@id');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/analytics
router.get('/analytics', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const monthly = await pool.request().query(`
            SELECT MONTH(createdAt) AS month, COUNT(*) AS count
            FROM assessments
            WHERE YEAR(createdAt) = YEAR(GETDATE())
            GROUP BY MONTH(createdAt)
            ORDER BY month
        `);
        const scores = await pool.request().query(`
            SELECT AVG(communicationScore) AS comm, AVG(socialScore) AS social,
                   AVG(cognitiveScore) AS cognitive, AVG(motorScore) AS motor
            FROM assessment_results
        `);
        res.json({ success: true, monthlyAssessments: monthly.recordset, averageScores: scores.recordset[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/export-data
router.get('/export-data', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT u.firstName, u.lastName, u.email, u.role, u.status, u.createdAt
            FROM users u ORDER BY u.createdAt DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
