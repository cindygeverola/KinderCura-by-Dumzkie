// Child model
// Each child document belongs to one parent user through parentId
const mongoose = require('mongoose');

const childSchema = new mongoose.Schema(
    {
        parentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        firstName: { type: String, required: true, trim: true },
        middleName: { type: String, trim: true, default: null },
        lastName: { type: String, required: true, trim: true },
        dateOfBirth: { type: Date, required: true },
        gender: {
            type: String,
            enum: ['male', 'female', 'other', null],
            default: null,
        },
        relationship: { type: String, trim: true, default: null },
        profileIcon: { type: String, default: 'child1' },
    },
    // timestamps: true automatically creates createdAt and updatedAt
    { timestamps: true }
);

module.exports = mongoose.models.Child || mongoose.model('Child', childSchema);
