'use strict';

/**
 * review.controller.js
 * Authenticated review management for the dashboard.
 */

const Review = require('../models/Review');
const Alert  = require('../models/Alert');

const tenantFilter = (user) => {
  if (user.role === 'super_admin') return {};
  return { business_id: user.business_id };
};

// GET /api/reviews — public reviews (4-5 star)
const listReviews = async (req, res) => {
  const { rating, channel, page, limit } = req.validatedQuery;
  const filter = { ...tenantFilter(req.user), is_public: true };
  if (rating) filter.rating = rating;

  const skip = (page - 1) * limit;
  const [total, reviews] = await Promise.all([
    Review.countDocuments(filter),
    Review.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer_id', 'name phone email')
      .select('-__v'),
  ]);

  const data = channel ? reviews.filter((r) => r.source === channel) : reviews;

  res.json({ data, total: channel ? data.length : total, page, limit, pages: Math.ceil(total / limit) });
};

// GET /api/reviews/private — private feedback (1-3 star)
const listPrivateFeedback = async (req, res) => {
  const { is_resolved, page, limit } = req.validatedQuery;
  const filter = { ...tenantFilter(req.user), is_public: false };
  if (is_resolved !== undefined) filter.resolved = is_resolved;

  const skip = (page - 1) * limit;
  const [total, feedback] = await Promise.all([
    Review.countDocuments(filter),
    Review.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer_id', 'name phone email')
      .select('-__v'),
  ]);

  res.json({ data: feedback, total, page, limit, pages: Math.ceil(total / limit) });
};

// PATCH /api/reviews/:id/resolve
const resolveFeedback = async (req, res) => {
  const review = await Review.findOneAndUpdate(
    { _id: req.params.id, ...tenantFilter(req.user), is_public: false },
    { $set: { resolved: true } },
    { new: true }
  ).select('-__v');

  if (!review) return res.status(404).json({ error: 'Feedback not found.' });

  await Alert.updateMany({ review_id: review._id }, { $set: { seen: true } });

  res.json({ data: review });
};

// GET /api/reviews/export
const exportReviews = async (req, res) => {
  const reviews = await Review.find(tenantFilter(req.user))
    .sort({ created_at: -1 })
    .populate('customer_id', 'name phone')
    .lean();
  const header = ['Date', 'Rating', 'Type', 'Channel', 'Customer Name', 'Phone', 'Feedback'];
  const rows = reviews.map(function(r) {
    return [
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '',
      r.rating,
      r.is_public ? 'Public (Google)' : 'Private',
      r.source || '',
      (r.customer_id && r.customer_id.name) ? r.customer_id.name : 'Anonymous',
      (r.customer_id && r.customer_id.phone) ? r.customer_id.phone : '',
      r.feedback_text || '',
    ];
  });
  const csv = [header, ...rows].map(function(row) {
    return row.map(function(cell) {
      return '"' + String(cell).replace(/"/g, '""') + '"';
    }).join(',');
  }).join('\n');
  var today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reviews-' + today + '.csv"');
  res.send(csv);
};

module.exports = { listReviews, listPrivateFeedback, resolveFeedback, exportReviews };