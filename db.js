// MongoDB connection helper for KinderCura Step 1
// IMPORTANT: the connection string is read from .env using MONGODB_URI
// Example .env value: MONGODB_URI=mongodb://127.0.0.1:27017/kindercura
const mongoose = require('mongoose');
require('dotenv').config();

// Prevents duplicate reconnect attempts if connectDB() is called more than once
let isConnected = false;

async function connectDB() {
    if (isConnected) return mongoose.connection;

    // This is where the app reads the MongoDB connection string.
    // 1) It first checks process.env.MONGODB_URI from your .env file.
    // 2) If that is missing, it falls back to the local default below.
    const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kindercura';

    try {
        // strictQuery keeps Mongoose query behavior predictable.
        mongoose.set('strictQuery', true);
        await mongoose.connect(mongoURI, {
            autoIndex: true,
        });
        isConnected = true;
        console.log('✅ Connected to MongoDB');
        return mongoose.connection;
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
        process.exit(1);
    }
}

module.exports = { connectDB, mongoose };
