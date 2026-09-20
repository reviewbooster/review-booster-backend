const PushSubscription = require('../models/PushSubscription');

// POST /api/notifications/subscribe
const subscribe = async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Invalid subscription payload' });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { user_id: req.user._id, endpoint, keys },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Push] subscribe failed:', err.message);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
};

// POST /api/notifications/unsubscribe
const unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    await PushSubscription.deleteOne({ endpoint, user_id: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
};

// GET /api/notifications/vapid-public-key
const getVapidPublicKey = (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
};

module.exports = { subscribe, unsubscribe, getVapidPublicKey };