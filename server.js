// Main Express server for KinderCura Step 1 MongoDB migration
// Purpose of this file:
// - connect the app to MongoDB
// - register middleware
// - serve HTML/CSS/icons/uploads
// - mount API routes
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { connectDB } = require('./db');

const app = express();

// Allow frontend pages to call the backend API during local development
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static folders so the browser can load styles, icons, and uploaded files
app.use('/css', express.static(path.join(__dirname, 'CSS files')));
app.use('/icons', express.static(path.join(__dirname, 'ICONS')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/assets/css', express.static(path.join(__dirname, 'CSS files')));
app.use('/assets/images', express.static(path.join(__dirname, 'ICONS')));
app.use(express.static(__dirname, { index: false }));
app.use(express.static(path.join(__dirname, 'SIGN-UP,LOGIN')));

// Friendly page routes for parent / pedia / admin pages
app.get('/parent/:page', (req, res) => res.sendFile(path.join(__dirname, 'PARENT', req.params.page)));
app.get('/pedia/:page', (req, res) => res.sendFile(path.join(__dirname, 'PEDIA', req.params.page)));
app.get('/admin/:page', (req, res) => res.sendFile(path.join(__dirname, 'ADMIN', req.params.page)));

// Step 1 routes already converted to MongoDB
app.use('/api/auth', require('./routes/auth'));
app.use('/api/children', require('./routes/children'));
app.use('/api/upload', require('./routes/upload'));

// Remaining routes are still from the older system for now.
// We left them mounted so the project structure stays familiar while migrating step by step.
app.use('/api/admin', require('./routes/admin'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/questions', require('./routes/custom-questions'));

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', server: 'KinderCura Mongo Step 1', time: new Date() });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'SIGN-UP,LOGIN', 'landing.html'));
});

const PORT = process.env.PORT || 3001;

// Start the server only after MongoDB connection succeeds
(async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`\n🚀 KinderCura running → http://localhost:${PORT}`);
    });
})();
