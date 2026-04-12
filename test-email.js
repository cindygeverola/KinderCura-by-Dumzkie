require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('USER:', process.env.EMAIL_USER);
console.log('PASS:', JSON.stringify(process.env.EMAIL_PASS));
console.log('PASS length:', process.env.EMAIL_PASS?.length);

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: 'KinderCura Test',
    text: 'It works!'
}).then(() => {
    console.log('✅ Email sent successfully!');
}).catch((err) => {
    console.log('❌ Error:', err.message);
});