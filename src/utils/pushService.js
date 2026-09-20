const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:support@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * sendPushToUser -- best-effort, non-fatal.
 * Sends to every device/subscription this user has registered.
 * A dead/expired subscription (404/410) is removed automatically.
 */
const sendPushToUser = async (user_id, payload) => {
  try {
    const subs = await PushSubscription.find({ user_id }).lean();
    if (!subs.length) return;

    const body = JSON.stringify(payload);

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            body
          );
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: sub._id });
          } else {
            console.error('[Push] Failed for subscription', sub._id, err.message);
          }
        }
      })
    );
  } catch (err) {
    console.error('[Push] sendPushToUser failed:', err.message);
  }
};

/**
 * sendPushToUsers -- fan out to multiple users (e.g. every owner/staff on a business).
 */
const sendPushToUsers = async (user_ids, payload) => {
  await Promise.all(user_ids.map((id) => sendPushToUser(id, payload)));
};

module.exports = { sendPushToUser, sendPushToUsers };