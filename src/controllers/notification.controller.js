const Notification = require('../models/Notification');

// GET /api/notifications
const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ business_id: req.user.business_id })
      .sort({ created_at: -1 })
      .limit(20)
      .lean();
    res.json({ notifications });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// GET /api/notifications/unread-count
const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      business_id: req.user.business_id,
      is_read: false,
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
};

// PUT /api/notifications/read-all  (must be registered before /:id/read)
const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { business_id: req.user.business_id, is_read: false },
      { is_read: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all read' });
  }
};

// PUT /api/notifications/:id/read
const markAsRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, business_id: req.user.business_id },
      { is_read: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

module.exports = { getNotifications, getUnreadCount, markAllRead, markAsRead };