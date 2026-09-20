'use strict';
/**
 * winback.controller.js
 * "Bring them back" -- one inactivity reminder, configurable per business,
 * with a business-type-aware starting point. Uses the customer's most
 * recent ReviewRequest as a proxy for "last visit" since there's no
 * dedicated visit/appointment tracking in the app. Fully manual: this only
 * surfaces who's due, sending is still a tap-through pre-filled WhatsApp
 * link, same as everywhere else -- nothing goes out on its own.
 */
const mongoose          = require('mongoose');
const Customer          = require('../models/Customer');
const ReviewRequest     = require('../models/ReviewRequest');
const WinBackSettings   = require('../models/WinBackSettings');
const Business          = require('../models/Business');
const { getWinBackDefaults } = require('../utils/winbackDefaults');

async function getOrDefaultSettings(business_id) {
  const existing = await WinBackSettings.findOne({ business_id }).lean();
  if (existing) return existing;

  const business = await Business.findById(business_id).select('type').lean();
  const fallback = getWinBackDefaults(business && business.type);
  return {
    business_id,
    enabled: false,
    inactive_days: fallback.inactive_days,
    message_text: fallback.message_text,
    offer_enabled: false,
    offer_text: fallback.offer_text,
    link_enabled: false,
  };
}

// GET /api/win-back/settings -- owner
const getSettings = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const settings = await getOrDefaultSettings(business_id);
  res.json({ data: settings });
};

// PATCH /api/win-back/settings -- owner
const updateSettings = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const { enabled, inactive_days, message_text, offer_enabled, offer_text, link_enabled } = req.body;

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
  if (offer_enabled !== undefined) update.offer_enabled = !!offer_enabled;
  if (offer_text !== undefined) {
    update.offer_text = (offer_text || '').trim().slice(0, 200);
  }
  if (link_enabled !== undefined) update.link_enabled = !!link_enabled;

  const settings = await WinBackSettings.findOneAndUpdate(
    { business_id },
    { $set: update, $setOnInsert: { business_id } },
    { upsert: true, new: true }
  );
  res.json({ data: settings });
};

// GET /api/win-back/due -- owner
// "Last activity" = the customer's most recent review-request send. New
// customers who've never been sent anything fall back to when they were
// added, so they don't get skipped forever.
//
// Suppression: a customer who was already win-backed within the current
// threshold window is left off the list -- they'll resurface naturally
// once that window passes again, rather than showing up every single day.
//
// "returned" in the summary counts customers who were win-backed and then
// got a real review-request sent afterward -- the closest honest signal
// we have for "they came back", using data that already exists.
const getDueCustomers = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const settings = await getOrDefaultSettings(business_id);
  if (!settings.enabled) {
    return res.json({ data: [], summary: { due_count: 0, returned_count: 0 }, settings });
  }

  const cutoff = new Date(Date.now() - settings.inactive_days * 24 * 60 * 60 * 1000);
  const businessObjectId = new mongoose.Types.ObjectId(business_id);

  const [customers, lastRequests] = await Promise.all([
    Customer.find({ business_id, opted_out: false })
      .select('name phone email added_at last_winback_sent')
      .lean(),
    ReviewRequest.aggregate([
      { $match: { business_id: businessObjectId, customer_id: { $ne: null } } },
      { $group: { _id: '$customer_id', last_sent: { $max: '$sent_at' } } },
    ]),
  ]);

  const lastSentMap = {};
  lastRequests.forEach((r) => { lastSentMap[String(r._id)] = r.last_sent; });

  let returnedCount = 0;
  const due = [];

  customers.forEach((c) => {
    const lastActivity = lastSentMap[String(c._id)] || c.added_at;
    const wasWinBacked = !!c.last_winback_sent;

    // Did a real review-request go out after we win-backed them? That's
    // the honest "they came back" signal -- count it regardless of
    // whether they're still below the threshold now.
    if (wasWinBacked) {
      const lastSent = lastSentMap[String(c._id)];
      if (lastSent && new Date(lastSent) > new Date(c.last_winback_sent)) {
        returnedCount += 1;
        return; // they're back -- don't also show them as due
      }
    }

    // Suppression: already win-backed within this threshold window --
    // don't re-suggest them again until the window passes once more.
    if (wasWinBacked && new Date(c.last_winback_sent) > cutoff) {
      return;
    }

    if (!c.phone) return; // needs a phone to actually send a WhatsApp nudge
    if (new Date(lastActivity) >= cutoff) return; // not due yet

    due.push({
      _id: c._id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      last_activity: lastActivity,
    });
  });

  due.sort((a, b) => new Date(a.last_activity) - new Date(b.last_activity));

  res.json({
    data: due,
    summary: { due_count: due.length, returned_count: returnedCount },
    settings,
  });
};

// POST /api/win-back/mark-sent/:customerId -- owner
// Best-effort: called right as the owner opens the pre-filled WhatsApp
// link, so we know not to keep suggesting this customer every day. We
// can't know whether the message actually got sent on WhatsApp's side --
// same limitation as every other "sent" action in this app.
const markSent = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const { customerId } = req.params;

  const customer = await Customer.findOneAndUpdate(
    { _id: customerId, business_id },
    { $set: { last_winback_sent: new Date() } },
    { new: true }
  ).select('_id last_winback_sent');

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found.' });
  }
  res.json({ data: customer });
};

module.exports = { getSettings, updateSettings, getDueCustomers, markSent };
