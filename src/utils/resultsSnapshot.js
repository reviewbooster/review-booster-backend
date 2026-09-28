'use strict';
/**
 * resultsSnapshot.js
 * One place that works out a business's "results": the Google numbers the
 * owner typed in (ReviewBooster can't read Google) plus activity counted
 * live from real records since they joined. Shared by the Your Results card
 * and the Success Story submission, so what an owner sees is exactly what
 * gets attached to their story. Nothing here is estimated.
 */
const Business      = require('../models/Business');
const Customer      = require('../models/Customer');
const ReviewRequest = require('../models/ReviewRequest');
const Review        = require('../models/Review');

async function buildResults(businessId) {
  const business = await Business.findById(businessId).select('created_at google_numbers').lean();
  if (!business) return null;

  const gn = business.google_numbers || {};
  const baseline = gn.baseline && gn.baseline.review_count != null ? gn.baseline : null;
  const updates = gn.updates || [];
  const current = updates.length ? updates[updates.length - 1] : null;

  const bid = business._id;
  const [qrScans, requestsSent, feedbackReceived, sentToGoogle, customers] = await Promise.all([
    ReviewRequest.countDocuments({ business_id: bid, channel: 'qr' }),
    ReviewRequest.countDocuments({ business_id: bid, channel: { $ne: 'qr' } }),
    Review.countDocuments({ business_id: bid, is_public: false }),
    Review.countDocuments({ business_id: bid, is_public: true }),
    Customer.countDocuments({ business_id: bid }),
  ]);

  return {
    since: business.created_at,
    google: { baseline: baseline, current: current },
    activity: {
      qr_scans: qrScans,
      requests_sent: requestsSent,
      feedback_received: feedbackReceived,
      sent_to_google: sentToGoogle,
      customers: customers,
    },
  };
}

module.exports = { buildResults };