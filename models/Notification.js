// routes/notifications.js
// Important fix:
// - adds DELETE /api/notifications/clear-all so the parent-side Clear all button works
// - adds DELETE /api/notifications/:id so single notification delete also works
// - keeps old read/count endpoints unchanged so the rest of KinderCura will not break

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const Notification = require('../models/Notification');

// Small helper so all notification payloads stay consistent in every page.
function formatNotification(n) {
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    relatedPage: n.relatedPage || null,
    isRead: !!n.isRead,
    createdAt: n.createdAt,
  };
}

// GET /api/notifications
// Loads the current user's notifications for the bell modal.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.userId })
      .sort({ createdAt: -1, id: -1 })
      .lean();

    res.json({
      success: true,
      notifications: notifications.map(formatNotification),
    });
  } catch (err) {
    console.error('notifications list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/count
// Used by the bell badge to show unread total.
router.get('/count', authMiddleware, async (req, res) => {
  try {
    const unread = await Notification.countDocuments({
      userId: req.user.userId,
      isRead: false,
    });

    res.json({ success: true, unread });
  } catch (err) {
    console.error('notifications count error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/read-all
// Marks every notification as read for the logged-in user.
router.put('/read-all', authMiddleware, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user.userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.json({
      success: true,
      updatedCount: result.modifiedCount || result.nModified || 0,
    });
  } catch (err) {
    console.error('notifications read-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notifications/clear-all
// This is the missing endpoint that caused the parent-side 404 error.
router.delete('/clear-all', authMiddleware, async (req, res) => {
  try {
    const result = await Notification.deleteMany({ userId: req.user.userId });

    res.json({
      success: true,
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    console.error('notifications clear-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/:id/read
// Marks one notification as read.
router.put('/:id/read', authMiddleware, async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      { id: Number(req.params.id), userId: req.user.userId },
      { $set: { isRead: true } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    res.json({ success: true, notification: formatNotification(updated) });
  } catch (err) {
    console.error('notification read error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notifications/:id
// Lets the user remove one notification from the list.
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await Notification.findOneAndDelete({
      id: Number(req.params.id),
      userId: req.user.userId,
    }).lean();

    if (!deleted) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    res.json({ success: true, deletedId: deleted.id });
  } catch (err) {
    console.error('notification delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
