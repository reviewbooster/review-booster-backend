const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPushToUsers } = require('./pushService');

/**
 * createNotification Ã¢â‚¬â€ non-fatal helper.
 * Errors are swallowed so the caller never crashes on a notification failure.
 */
const createNotification = async ({
  business_id,
  type,
  title,
  message,
  entity_id   = null,
  entity_type = null,
}) => {
  if (!business_id) return;
  try {
    await Notification.create({ business_id, type, title, message, entity_id, entity_type });

    const users = await User.find({ business_id }).select('_id').lean();
    if (users.length) {
      const url = entity_type === 'review' ? '/dashboard/reviews'
        : entity_type === 'feedback' ? '/dashboard/feedback'
        : '/dashboard';
      await sendPushToUsers(users.map((u) => u._id), { title, body: message, url });
    }
  } catch (err) {
    console.error('[Notification] Failed to create:', err.message);
  }
};

module.exports = { createNotification };