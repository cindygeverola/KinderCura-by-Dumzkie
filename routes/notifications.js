// routes/notifications.js
// MongoDB replacement for the in-app notification bell and modal.
// The relatedPage field is returned when available so pages can open the exact target.
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const Notification = require('../models/Notification');

// GET /api/notifications
router.get('/', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.userId })
      .sort({ createdAt: -1, id: -1 })
      .lean();

    res.json({
      success: true,
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        relatedPage: n.relatedPage || null,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/count
router.get('/count', authMiddleware, async (req, res) => {
  try {
    const unread = await Notification.countDocuments({ userId: req.user.userId, isRead: false });
    res.json({ success: true, unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authMiddleware, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { id: Number(req.params.id), userId: req.user.userId },
      { $set: { isRead: true } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.userId, isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
