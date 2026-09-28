'use strict';
/**
 * usageMeter.js
 * Shared helpers for the monthly usage quotas (AI replies, follow-ups,
 * win-back contacts, and review requests/SMS via the existing
 * ReviewRequest collection). Everything is counted live from real records
 * -- nothing here is a manually incremented/reset counter, so it can never
 * drift from what actually happened, and there's no monthly reset job to
 * maintain.
 */
const UsageEvent    = require('../models/UsageEvent');
const ReviewRequest = require('../models/ReviewRequest');

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

// Logs one metered action (call this AFTER the action actually succeeds,
// never before). Best-effort by design -- a failed log write should never
// block or undo the feature it's recording; callers can still await it if
// they want to be sure it landed before responding.
async function recordUsage(business_id, type, ref_id) {
  try {
    await UsageEvent.create({ business_id, type, ref_id: ref_id || null });
  } catch (e) {
    // Never let usage logging break the actual feature.
  }
}

// Count of UsageEvent rows of `type` for this business since the start of
// the current calendar month.
async function getUsageCount(business_id, type) {
  return UsageEvent.countDocuments({
    business_id,
    type,
    created_at: { $gte: startOfCurrentMonth() },
  });
}

// Review requests sent this month, across WhatsApp/SMS/Email combined --
// QR-sourced requests are never metered (QR itself is always unlimited).
// Pass `channel` to scope to just one channel, for the stricter SMS sub-cap.
async function getReviewRequestCount(business_id, channel) {
  return ReviewRequest.countDocuments({
    business_id,
    channel: channel || { $ne: 'qr' },
    sent_at: { $gte: startOfCurrentMonth() },
  });
}

module.exports = { recordUsage, getUsageCount, getReviewRequestCount, startOfCurrentMonth };