const Notification = require('../models/Notification');

/**
 * createNotification — non-fatal helper.
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
  } catch (err) {
    console.error('[Notification] Failed to create:', err.message);
  }
};

module.exports = { createNotification };