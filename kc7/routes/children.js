// Child routes converted to MongoDB
// These routes are used by dashboard.html and profile.html to load/add child records
const express = require('express');
const Child = require('../models/Child');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Compare only the calendar date so duplicate child checks stay simple
function sameDay(a, b) {
    return new Date(a).toISOString().split('T')[0] === new Date(b).toISOString().split('T')[0];
}

// Load all children that belong to the logged-in parent
// GET /api/children
router.get('/', authMiddleware, async (req, res) => {
    try {
        const children = await Child.find({ parentId: req.user.userId }).sort({ createdAt: -1 }).lean();
        const normalized = children.map(c => ({ ...c, id: String(c._id) }));
        res.json({ success: true, children: normalized });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a new child for the logged-in parent
// POST /api/children/register
router.post('/register', authMiddleware, async (req, res) => {
    try {
        const { firstName, middleName, lastName, dateOfBirth, gender, relationship } = req.body;

        if (!firstName || !lastName || !dateOfBirth) {
            return res.status(400).json({ error: 'First name, last name, and date of birth are required.' });
        }

        const cleanFirst = String(firstName).trim();
        const cleanLast = String(lastName).trim();
        const dob = new Date(dateOfBirth);

        const existing = await Child.findOne({
            parentId: req.user.userId,
            firstName: new RegExp(`^${cleanFirst}$`, 'i'),
            lastName: new RegExp(`^${cleanLast}$`, 'i'),
        });

        if (existing && sameDay(existing.dateOfBirth, dob)) {
            return res.status(409).json({ error: 'This child is already registered for this parent.' });
        }

        const child = await Child.create({
            parentId: req.user.userId,
            firstName: cleanFirst,
            middleName: middleName ? String(middleName).trim() : null,
            lastName: cleanLast,
            dateOfBirth: dob,
            gender: gender || null,
            relationship: relationship || null,
        });

        res.status(201).json({
            success: true,
            childId: String(child._id),
            message: 'Child registered successfully.',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Load one child by id, but only if the child belongs to the logged-in parent
// GET /api/children/:childId
router.get('/:childId', authMiddleware, async (req, res) => {
    try {
        const child = await Child.findOne({ _id: req.params.childId, parentId: req.user.userId }).lean();
        if (!child) {
            return res.status(404).json({ error: 'Child not found.' });
        }

        res.json({ success: true, child: { ...child, id: String(child._id) } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
