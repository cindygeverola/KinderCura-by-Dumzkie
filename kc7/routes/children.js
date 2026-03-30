const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/children — get all children for logged-in parent
router.get('/', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('parentId', sql.Int, req.user.userId)
            .query('SELECT * FROM children WHERE parentId = @parentId ORDER BY createdAt DESC');
        res.json({ success: true, children: result.recordset });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/children/register
router.post('/register', authMiddleware, async (req, res) => {
    try {
        const { firstName, lastName, dateOfBirth, gender, relationship } = req.body;
        if (!firstName || !lastName || !dateOfBirth)
            return res.status(400).json({ error: 'First name, last name, and date of birth are required.' });

        const pool = await poolPromise;
        const result = await pool.request()
            .input('parentId',     sql.Int,      req.user.userId)
            .input('firstName',    sql.NVarChar,  firstName)
            .input('lastName',     sql.NVarChar,  lastName)
            .input('dateOfBirth',  sql.Date,      dateOfBirth)
            .input('gender',       sql.NVarChar,  gender       || null)
            .input('relationship', sql.NVarChar,  relationship || null)
            .query(`
                INSERT INTO children (parentId, firstName, lastName, dateOfBirth, gender, relationship)
                OUTPUT INSERTED.id
                VALUES (@parentId, @firstName, @lastName, @dateOfBirth, @gender, @relationship)
            `);

        const childId = result.recordset[0].id;
        res.status(201).json({ success: true, childId, message: 'Child registered successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/children/:childId
router.get('/:childId', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('childId', sql.Int, req.params.childId)
            .input('parentId', sql.Int, req.user.userId)
            .query('SELECT * FROM children WHERE id = @childId AND parentId = @parentId');
        if (result.recordset.length === 0)
            return res.status(404).json({ error: 'Child not found.' });
        res.json({ success: true, child: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
