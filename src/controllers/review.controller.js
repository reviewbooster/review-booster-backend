'use strict';

/**
 * review.controller.js
 * Authenticated review management for the dashboard.
 */

const Review = require('../models/Review');
const Alert  = require('../models/Alert');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const { generateReply } = require('../utils/replyTemplates');
const { buildBrandedCsv, sendBrandedPdf } = require('../utils/exportBranding');
const { canUseFeature } = require('../utils/planLimits');

const tenantFilter = (user) => {
  if (user.role === 'super_admin') return {};
  return { business_id: user.business_id };
};

const SORT_OPTIONS = {
  newest:      { created_at: -1 },
  oldest:      { created_at: 1 },
  rating_high: { rating: -1, created_at: -1 },
  rating_low:  { rating: 1, created_at: -1 },
};

// GET /api/reviews â€” public reviews (4-5 star)
const listReviews = async (req, res) => {
  const { rating, channel, search, start_date, end_date, sort, page, limit } = req.validatedQuery;
  const filter = { ...tenantFilter(req.user), is_public: true };
  if (rating)  filter.rating = rating;
  if (channel) filter.source = channel;
  if (start_date || end_date) {
    filter.created_at = {};
    if (start_date) {
      const s = new Date(start_date); s.setHours(0, 0, 0, 0);
      filter.created_at.$gte = s;
    }
    if (end_date) {
      const e = new Date(end_date); e.setHours(23, 59, 59, 999);
      filter.created_at.$lte = e;
    }
  }

  const skip = (page - 1) * limit;
  const sortSpec = SORT_OPTIONS[sort] || SORT_OPTIONS.newest;

  let reviews = await Review.find(filter)
    .populate('customer_id', 'name phone email')
    .select('-__v')
    .sort(sortSpec);

  if (search) {
    const q = search.toLowerCase();
    reviews = reviews.filter((r) => {
      const name = r.customer_id && r.customer_id.name ? r.customer_id.name.toLowerCase() : '';
      const text = r.feedback_text ? r.feedback_text.toLowerCase() : '';
      return name.includes(q) || text.includes(q);
    });
  }

  const total = reviews.length;
  const data  = reviews.slice(skip, skip + limit);

  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
};

// GET /api/reviews/private -- private feedback (1-3 star)
const listPrivateFeedback = async (req, res) => {
  const { rating, channel, tag, stage, search, start_date, end_date, sort, is_resolved, page, limit } = req.validatedQuery;
  const filter = { ...tenantFilter(req.user), is_public: false };
  if (is_resolved !== undefined) filter.resolved = is_resolved;
  if (rating)  filter.rating = rating;
  if (channel) filter.source = channel;
  if (tag)     filter.tags = tag;
  if (stage === 'new')         filter.stage = 'new';
  if (stage === 'in_progress') filter.stage = { $in: ['processing', 'awaiting_confirmation'] };
  if (start_date || end_date) {
    filter.created_at = {};
    if (start_date) {
      const s = new Date(start_date); s.setHours(0, 0, 0, 0);
      filter.created_at.$gte = s;
    }
    if (end_date) {
      const e = new Date(end_date); e.setHours(23, 59, 59, 999);
      filter.created_at.$lte = e;
    }
  }

  const skip = (page - 1) * limit;
  const sortSpec = SORT_OPTIONS[sort] || SORT_OPTIONS.newest;

  const totalUnresolved = await Review.countDocuments({ ...tenantFilter(req.user), is_public: false, resolved: false });

  let feedback = await Review.find(filter)
    .populate('customer_id', 'name phone email')
    .select('-__v')
    .sort(sortSpec);

  if (search) {
    const q = search.toLowerCase();
    feedback = feedback.filter((r) => {
      const name = r.customer_id && r.customer_id.name ? r.customer_id.name.toLowerCase() : '';
      const text = r.feedback_text ? r.feedback_text.toLowerCase() : '';
      return name.includes(q) || text.includes(q);
    });
  }

  const total = feedback.length;
  const data  = feedback.slice(skip, skip + limit);

  res.json({ data, total, totalUnresolved, page, limit, pages: Math.ceil(total / limit) });
};

// GET /api/reviews/tags â€” distinct categories currently in use, for the
// feedback filter dropdown. Categories are business-type-aware and dynamic
// (see feedbackTagger.js), so this replaces a hardcoded option list.
const listFeedbackTags = async (req, res) => {
  const tags = await Review.distinct('tags', { ...tenantFilter(req.user), is_public: false });
  res.json({ data: tags.filter(Boolean).sort() });
};

// GET /api/reviews/:id/customer-context â€” a few honest facts about the
// customer this feedback belongs to, fetched only when the detail modal
// opens (not on every list load). No invented numbers: just what's on
// record -- when they were added, how many times they've reviewed/given
// feedback for this business, and when they were last contacted. Null for
// anonymous QR feedback with no customer on file.
const getCustomerContext = async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, ...tenantFilter(req.user) }).select('customer_id business_id');
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  if (!review.customer_id) return res.json({ data: null });

  const [customer, totalReviews] = await Promise.all([
    Customer.findById(review.customer_id).select('added_at last_contacted').lean(),
    Review.countDocuments({ business_id: review.business_id, customer_id: review.customer_id }),
  ]);

  if (!customer) return res.json({ data: null });

  res.json({
    data: {
      customer_since: customer.added_at || null,
      total_reviews:  totalReviews,
      last_contacted: customer.last_contacted || null,
    },
  });
};

// POST /api/reviews/:id/generate-reply â€” template-based draft reply
const generateReplyForReview = async (req, res) => {
  const review = await Review.findOne({ _id: req.params.id, ...tenantFilter(req.user) })
    .populate('customer_id', 'name')
    .select('-__v');

  if (!review) return res.status(404).json({ error: 'Review not found.' });

  const business = await Business.findById(review.business_id).select('name plan').lean();

  if (req.user.role !== 'super_admin' && !(await canUseFeature(business?.plan, 'ai_reply'))) {
    return res.status(403).json({ error: 'AI reply drafts aren\u2019t available on your current plan. Upgrade to Pro or Agency to use this.' });
  }

  const { template } = req.body || {};

  const draft = generateReply({
    reviewId: review._id,
    rating: review.rating,
    isPublic: review.is_public,
    customerName: review.customer_id?.name,
    businessName: business?.name,
    feedbackText: review.feedback_text,
    template: template || 'apologize',
  });

  res.json({ data: { draft } });
};

// PATCH /api/reviews/:id/resolve
const resolveFeedback = async (req, res) => {
  // Optional staff-directory name picked at resolve-time (e.g. on a shared
  // front-desk device) overrides the logged-in account's own name â€” lets
  // attribution reflect who actually handled it, not just who's logged in.
  const { resolved_by } = req.body || {};
  const cleanResolvedBy = resolved_by && resolved_by.trim() ? resolved_by.trim() : (req.user.name || null);

  const review = await Review.findOneAndUpdate(
    { _id: req.params.id, ...tenantFilter(req.user), is_public: false },
    { $set: { resolved: true, resolved_by: cleanResolvedBy, resolved_at: new Date() } },
    { new: true }
  ).select('-__v');

  if (!review) return res.status(404).json({ error: 'Feedback not found.' });

  await Alert.updateMany({ review_id: review._id }, { $set: { seen: true } });

  res.json({ data: review });
};

// GET /api/reviews/export
const exportReviews = async (req, res) => {
  const { rating, channel, search, start_date, end_date } = req.query;
  const filter = { ...tenantFilter(req.user), is_public: true };
  if (rating)  filter.rating = parseInt(rating, 10);
  if (channel) filter.source = channel;
  if (start_date || end_date) {
    filter.created_at = {};
    if (start_date) {
      const s = new Date(start_date); s.setHours(0, 0, 0, 0);
      filter.created_at.$gte = s;
    }
    if (end_date) {
      const e = new Date(end_date); e.setHours(23, 59, 59, 999);
      filter.created_at.$lte = e;
    }
  }

  let reviews = await Review.find(filter)
    .sort({ created_at: -1 })
    .populate('customer_id', 'name phone')
    .lean();

  if (search) {
    const q = String(search).toLowerCase();
    reviews = reviews.filter(function(r) {
      const name = (r.customer_id && r.customer_id.name) ? r.customer_id.name.toLowerCase() : '';
      const text = r.feedback_text ? r.feedback_text.toLowerCase() : '';
      return name.includes(q) || text.includes(q);
    });
  }

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
  const format = (req.query.format === 'pdf') ? 'pdf' : 'csv';
  var today = new Date().toISOString().slice(0, 10);

  if (format === 'pdf') {
    return sendBrandedPdf(res, {
      title: 'Reviews Export',
      header: header,
      rows: rows,
      filename: 'reviews-' + today + '.pdf',
    });
  }

  const csv = buildBrandedCsv('Reviews Export', header, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reviews-' + today + '.csv"');
  res.send(csv);
};

// PATCH /api/reviews/:id/stage â€” progress tracking before resolution
const VALID_STAGES = ['new', 'processing', 'awaiting_confirmation'];
const setFeedbackStage = async (req, res) => {
  const { stage } = req.body || {};
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: '"stage" must be one of: ' + VALID_STAGES.join(', ') + '.' });
  }

  const review = await Review.findOneAndUpdate(
    { _id: req.params.id, ...tenantFilter(req.user), is_public: false },
    { $set: { stage } },
    { new: true }
  ).select('-__v');

  if (!review) return res.status(404).json({ error: 'Feedback not found.' });

  res.json({ data: review });
};

// PATCH /api/reviews/:id/mark-sent â€” called when the owner taps a channel
// button to send their reply. Records that we opened the send link and
// auto-advances the stage to "Awaiting Confirmation" (Section 5 of the PDF:
// sending a response should move the case along automatically). Does NOT
// confirm the customer received anything -- same wa.me/mailto limit as
// everywhere else.
const VALID_SEND_CHANNELS = ['whatsapp', 'sms', 'email'];
const markFeedbackSent = async (req, res) => {
  const { channel, reply_text } = req.body || {};
  if (!VALID_SEND_CHANNELS.includes(channel)) {
    return res.status(400).json({ error: '"channel" must be one of: ' + VALID_SEND_CHANNELS.join(', ') + '.' });
  }
  const cleanReplyText = (reply_text || '').trim().slice(0, 2000) || null;

  const review = await Review.findOneAndUpdate(
    { _id: req.params.id, ...tenantFilter(req.user), is_public: false },
    { $set: { stage: 'awaiting_confirmation', reply_sent_at: new Date(), reply_channel: channel, reply_text: cleanReplyText } },
    { new: true }
  ).select('-__v');

  if (!review) return res.status(404).json({ error: 'Feedback not found.' });

  res.json({ data: review });
};


const setFeedbackNotes = async (req, res) => {
  const { notes } = req.body || {};
  const cleanNotes = (notes || '').trim().slice(0, 1000) || null;

  const review = await Review.findOneAndUpdate(
    { _id: req.params.id, ...tenantFilter(req.user), is_public: false },
    { $set: { internal_notes: cleanNotes } },
    { new: true }
  ).select('-__v');

  if (!review) return res.status(404).json({ error: 'Feedback not found.' });

  res.json({ data: review });
};

module.exports = { listReviews, listPrivateFeedback, listFeedbackTags, getCustomerContext, resolveFeedback, exportReviews, generateReplyForReview, setFeedbackStage, markFeedbackSent, setFeedbackNotes };