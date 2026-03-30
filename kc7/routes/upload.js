const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ── Storage config — saves to public/uploads/profiles/ ───────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase();
        const name = `${req.uploadType || 'user'}_${Date.now()}${ext}`;
        cb(null, name);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, jpeg, png, gif, webp)'));
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// POST /api/upload/profile — upload user's own profile picture
router.post('/profile', authMiddleware, (req, res) => {
    req.uploadType = `parent_${req.user.userId}`;
    upload.single('photo')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        try {
            const picPath = `/uploads/profiles/${req.file.filename}`;
            const pool    = await poolPromise;

            // Delete old file if exists
            const old = await pool.request()
                .input('id', sql.Int, req.user.userId)
                .query('SELECT profileIcon FROM users WHERE id=@id');
            if (old.recordset[0]?.profileIcon?.startsWith('/uploads/')) {
                const oldFile = path.join(__dirname, '..', 'public', old.recordset[0].profileIcon);
                if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
            }

            // Save path to DB
            await pool.request()
                .input('id',   sql.Int,      req.user.userId)
                .input('path', sql.NVarChar,  picPath)
                .query('UPDATE users SET profileIcon=@path WHERE id=@id');

            res.json({ success: true, path: picPath });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// POST /api/upload/child/:childId — upload child's profile picture
router.post('/child/:childId', authMiddleware, (req, res) => {
    req.uploadType = `child_${req.params.childId}`;
    upload.single('photo')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        try {
            const picPath = `/uploads/profiles/${req.file.filename}`;
            const pool    = await poolPromise;

            // Delete old file if exists
            const old = await pool.request()
                .input('id', sql.Int, req.params.childId)
                .query('SELECT profileIcon FROM children WHERE id=@id');
            if (old.recordset[0]?.profileIcon?.startsWith('/uploads/')) {
                const oldFile = path.join(__dirname, '..', 'public', old.recordset[0].profileIcon);
                if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
            }

            // Save path to DB
            await pool.request()
                .input('id',   sql.Int,      req.params.childId)
                .input('path', sql.NVarChar,  picPath)
                .query('UPDATE children SET profileIcon=@path WHERE id=@id');

            res.json({ success: true, path: picPath });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

module.exports = router;
