'use strict';
/**
 * winback.controller.js
 * "Bring them back" — one generic inactivity reminder, configurable per
 * business, works the same way regardless of business type. Uses the
 * customer's most recent ReviewRequest as a proxy for "last visit" since
 * there's no dedicated visit/appointment tracking in the app. Fully
 * manual: this only surfaces who's due, sending is still a tap-through
 * pre-filled WhatsApp link, same as everywhere else.
 */
const mongoose         = require('mongoose');
const Customer         = require('../models/Customer');
const ReviewRequest    = require('../models/ReviewRequest');
const WinBackSettings  = require('../models/WinBackSettings');

async function getOrDefaultSettings(business_id) {
  const settings = await WinBackSettings.findOne({ business_id }).lean();
  return settings || {
    business_id,
    enabled: false,
    inactive_days: 30,
    message_text: "Hi {name}, it's been a while since we've seen you! We'd love to have you back.",
  };
}

// GET /api/win-back/settings — owner
const getSettings = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const settings = await getOrDefaultSettings(business_id);
  res.json({ data: settings });
};

// PATCH /api/win-back/settings — owner
const updateSettings = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const { enabled, inactive_days, message_text } = req.body;

  const update = {};
  if (enabled !== undefined) update.enabled = !!enabled;
  if (inactive_days !== undefined) {
    const n = Number(inactive_days);
    if (!Number.isFinite(n) || n < 1) {
      return res.status(400).json({ error: 'Days must be a number of at least 1.' });
    }
    update.inactive_days = n;
  }
  if (message_text !== undefined) {
    const clean = (message_text || '').trim();
    if (!clean) return res.status(400).json({ error: 'Message text cannot be empty.' });
    update.message_text = clean.slice(0, 500);
  }

  const settings = await WinBackSettings.findOneAndUpdate(
    { business_id },
    { $set: update, $setOnInsert: { business_id } },
    { upsert: true, new: true }
  );
  res.json({ data: settings });
};

// GET /api/win-back/due — owner
// "Last activity" = the customer's most recent review-request send. New
// customers who've never been sent anything fall back to when they were
// added, so they don't get skipped forever.
const getDueCustomers = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const settings = await getOrDefaultSettings(business_id);
  if (!settings.enabled) {
    return res.json({ data: [], settings });
  }

  const cutoff = new Date(Date.now() - settings.inactive_days * 24 * 60 * 60 * 1000);

  const [customers, lastRequests] = await Promise.all([
    Customer.find({ business_id, opted_out: false }).select('name phone email added_at').lean(),
    ReviewRequest.aggregate([
      { $match: { business_id: new mongoose.Types.ObjectId(business_id), customer_id: { $ne: null } } },
      { $group: { _id: '$customer_id', last_sent: { $max: '$sent_at' } } },
    ]),
  ]);

  const lastSentMap = {};
  lastRequests.forEach((r) => { lastSentMap[String(r._id)] = r.last_sent; });

  const due = customers
    .filter((c) => c.phone) // needs a phone to actually send a WhatsApp nudge
    .map((c) => {
      const lastActivity = lastSentMap[String(c._id)] || c.added_at;
      return {
        _id: c._id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        last_activity: lastActivity,
      };
    })
    .filter((c) => new Date(c.last_activity) < cutoff)
    .sort((a, b) => new Date(a.last_activity) - new Date(b.last_activity));

  res.json({ data: due, settings });
};

module.exports = { getSettings, updateSettings, getDueCustomers };
