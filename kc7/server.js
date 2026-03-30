// server.js  –  KinderCura API Server v2.0
const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML, CSS, images, uploaded photos)
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth',            require('./routes/auth'));
app.use('/api/upload',          require('./routes/upload'));
app.use('/api/admin',           require('./routes/admin'));
app.use('/api/children',        require('./routes/children'));
app.use('/api/assessments',     require('./routes/assessments'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/appointments',    require('./routes/appointments'));

app.get('/api/health', (req, res) => res.json({ status: 'OK', server: 'KinderCura v2.0', time: new Date() }));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀  KinderCura running at http://localhost:${PORT}`);
    console.log(`\n📡  Upload endpoints:`);
    console.log(`    POST /api/upload/profile        — user photo`);
    console.log(`    POST /api/upload/child/:childId — child photo\n`);
});
