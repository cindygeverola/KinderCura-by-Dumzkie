// JWT auth middleware
// Reads the token from Authorization: Bearer <token>
// JWT_SECRET must exist in your .env file
const jwt = require('jsonwebtoken');
require('dotenv').config();

function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'No token. Please log in.' });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token invalid or expired. Please log in again.' });
    }
}

function adminOnly(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admins only.' });
    }
    next();
}

module.exports = { authMiddleware, adminOnly };
