// middleware/auth.js

const jwt = require('jsonwebtoken');
require('dotenv').config();

// =========================
// AUTH MIDDLEWARE
// =========================
function authMiddleware(req, res, next) {
    const header = req.headers['authorization'];
    const token = header && header.split(' ')[1]; // Bearer token

    if (!token) {
        return res.status(401).json({
            error: 'No token. Please log in.'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // attach user data to request
        next();
    } catch (err) {
        return res.status(403).json({
            error: 'Token invalid or expired. Please log in again.'
        });
    }
}

// =========================
// ADMIN ONLY
// =========================
function adminOnly(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Admins only.'
        });
    }
    next();
}

// =========================
// EXPORT
// =========================
module.exports = {
    authMiddleware,
    adminOnly
};