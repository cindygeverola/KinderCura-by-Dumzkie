// seed-admin.js
// Purpose:
// - creates a default admin account if none exists yet
// - useful after migrating from SQL Server so you can enter the admin side
// Connection note:
// - this script uses connectDB() from db.js
// - db.js reads the MongoDB URI from process.env.MONGODB_URI in your .env file

require('dotenv').config();
const bcrypt = require('bcrypt');
const { connectDB } = require('./db');
const User = require('./models/User');

// Main script runner
async function run() {
  await connectDB();

  const existing = await User.findOne({ role: 'admin' });
  if (existing) {
    console.log('✅ Admin already exists');
    console.log('Username:', existing.username);
    console.log('Email:', existing.email);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash('Admin@1234', 10);
  const admin = await User.create({
    firstName: 'System',
    middleName: null,
    lastName: 'Admin',
    username: 'admin',
    email: 'admin@kindercura.com',
    passwordHash,
    role: 'admin',
    status: 'active',
    emailVerified: true,
    profileIcon: 'avatar1',
  });

  console.log('✅ Admin account created');
  console.log('Username: admin');
  console.log('Email: admin@kindercura.com');
  console.log('Password: Admin@1234');
  console.log('Mongo _id:', admin._id.toString());
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Failed to seed admin:', err);
  process.exit(1);
});
