'use strict';
/**
 * analytics.controller.js
 * Aggregated stats for the dashboard overview page.
 * Session 17 -- added last_month for trend indicators.
 * Session 18 fix -- ?days param for rolling period on summary + chart.
 * Later fix -- headline stats period-bounded, custom date ranges, and optional
 * ?channel / ?rating filters for pages (like Reviews) that need filter-aware stats.
 */
const Review        = require('../models/Review');
const ReviewRequest = require('../models/ReviewRequest');
const Business      = require('../models/Business');
const mongoose      = require('mongoose');
const { canUseFeature, getEffectivePlanSlug } = require('../utils/planLimits');
const { lockedResponse } = require('../utils/planGate');
const { fetchImageBuffer, sendAnalyticsReportPdf } = require('../utils/exportBranding');

const tenantFilter = (user) => {
  if (user.role === 'super_admin') return {};
  return { business_id: new mongoose.Types.ObjectId(user.business_id) };
};

// Shared by getSummary (JSON) and exportAnalyticsReport (PDF) -- one source
// of truth for the numbers, so the exported report can never drift from
// what the Analytics page itself shows. Throws { statusCode, message } for
// the one validation case (bad date range); callers translate that to a
// 400 response themselves since this function doesn't have access to `res`.
const computeSummaryData = async (req) => {
  const filter = tenantFilter(req.user);

  let periodStart, periodEnd, days;
  if (req.query.start_date && req.query.end_date) {
    periodStart = new Date(req.query.start_date);
    periodEnd   = new Date(req.query.end_date);
    if (isNaN(periodStart) || isNaN(periodEnd) || periodStart > periodEnd) {
      const err = new Error('Invalid date range.');
      err.statusCode = 400;
      throw err;
    }
    periodStart.setHours(0, 0, 0, 0);
    periodEnd.setHours(23, 59, 59, 999);
    days = Math.max(1, Math.round((periodEnd - periodStart) / (1000 * 60 * 60 * 24)) + 1);
  } else {
    days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));
    periodEnd = new Date();
    periodEnd.setHours(23, 59, 59, 999);
    periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - (days - 1));
    periodStart.setHours(0, 0, 0, 0);
  }

  const prevEnd = new Date(periodStart.getTime() - 1);
  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - days);

  const periodFilter = { ...filter, created_at: { $gte: periodStart, $lte: periodEnd } };

  // Optional extra filters -- only used by pages (like Reviews) that pass them;
  // Dashboard's funnel/request stats are intentionally left unaffected by these.
  const reviewPeriodFilter = { ...periodFilter };
  if (req.query.channel) reviewPeriodFilter.source = req.query.channel;
  if (req.query.rating)  reviewPeriodFilter.rating  = parseInt(req.query.rating, 10);

  const [
    requestStats,
    reviewStats,
    openedCount,
    unresolvedCount,
    reviewsThisPeriod,
    requesteesResult,
    deliveredCount,
    reviewsLastPeriod,
    ratingBreakdownAgg,
    reviewsByChannelAgg,
    avgDaysToReviewAgg,
    prevTotalRequests,
  ] = await Promise.all([
    ReviewRequest.aggregate([
      { $match: periodFilter },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]),
    Review.aggregate([
      { $match: reviewPeriodFilter },
      {
        $group: {
          _id:           null,
          total:         { $sum: 1 },
          total_public:  { $sum: { $cond: [{ $eq: ['$is_public', true]  }, 1, 0] } },
          total_private: { $sum: { $cond: [{ $eq: ['$is_public', false] }, 1, 0] } },
          avg_rating:    { $avg: '$rating' },
        },
      },
    ]),
    ReviewRequest.countDocuments({ ...periodFilter, opened_at: { $ne: null } }),
    Review.countDocuments({ ...filter, is_public: false, resolved: false }),
    Review.aggregate([
      { $match: { ...filter, created_at: { $gte: periodStart, $lte: periodEnd } } },
      {
        $group: {
          _id:           null,
          total:         { $sum: 1 },
          total_public:  { $sum: { $cond: [{ $eq: ['$is_public', true]  }, 1, 0] } },
          total_private: { $sum: { $cond: [{ $eq: ['$is_public', false] }, 1, 0] } },
        },
      },
    ]),
    ReviewRequest.aggregate([
      { $match: { ...periodFilter, customer_id: { $ne: null } } },
      { $group: { _id: null, ids: { $addToSet: '$customer_id' } } },
      { $project: { count: { $size: '$ids' } } },
    ]),
    ReviewRequest.countDocuments({ ...periodFilter, status: { $ne: 'failed' } }),
    Review.aggregate([
      { $match: { ...filter, created_at: { $gte: prevStart, $lte: prevEnd } } },
      {
        $group: {
          _id:           null,
          total:         { $sum: 1 },
          total_public:  { $sum: { $cond: [{ $eq: ['$is_public', true]  }, 1, 0] } },
          total_private: { $sum: { $cond: [{ $eq: ['$is_public', false] }, 1, 0] } },
        },
      },
    ]),
    // Rating Breakdown -- real histogram of the 1-5 star field, same period
    // filter as the headline review stats.
    Review.aggregate([
      { $match: reviewPeriodFilter },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
    // Per-channel review counts, paired with requestStats (sent per channel)
    // below to build an honest Sent / Reviews / Conversion table -- no
    // "campaign" or "source" categories that don't exist in this app.
    Review.aggregate([
      { $match: periodFilter },
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]),
    // Average time to review: Review.created_at minus the originating
    // ReviewRequest's sent_at, joined via request_id. Real elapsed time,
    // not an estimate.
    Review.aggregate([
      { $match: periodFilter },
      { $lookup: { from: 'reviewrequests', localField: 'request_id', foreignField: '_id', as: 'req' } },
      { $unwind: '$req' },
      { $project: { diffDays: { $divide: [{ $subtract: ['$created_at', '$req.sent_at'] }, 1000 * 60 * 60 * 24] } } },
      { $group: { _id: null, avg: { $avg: '$diffDays' } } },
    ]),
    // Previous period's request count -- lets the frontend compute a real
    // conversion-rate change insight instead of only having this period's.
    ReviewRequest.countDocuments({ ...filter, created_at: { $gte: prevStart, $lte: prevEnd } }),
  ]);

  const byChannel   = { whatsapp: 0, sms: 0, email: 0 };
  let totalRequests = 0;
  for (const s of requestStats) {
    byChannel[s._id] = s.count;
    totalRequests   += s.count;
  }

  const rs   = reviewStats[0]       || { total: 0, total_public: 0, total_private: 0, avg_rating: 0 };
  const mtd  = reviewsThisPeriod[0] || { total: 0, total_public: 0, total_private: 0 };
  const lmtd = reviewsLastPeriod[0] || { total: 0, total_public: 0, total_private: 0 };

  // Rating Breakdown -- fill in all 5 stars so a business with no 1-star
  // reviews still shows a zero row instead of a gap.
  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratingBreakdownAgg.forEach((r) => { if (r._id >= 1 && r._id <= 5) ratingCounts[r._id] = r.count; });
  const ratingTotal = Object.values(ratingCounts).reduce((a, b) => a + b, 0);
  const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => ({
    rating: star,
    count:  ratingCounts[star],
    pct:    ratingTotal > 0 ? Math.round((ratingCounts[star] / ratingTotal) * 100) : 0,
  }));

  // Channel performance table -- real channels only (whatsapp/sms/email/qr),
  // paired sent + reviews + conversion. Uses the same "conversion = any
  // review submitted / sent" definition as conversion_rate above, for
  // consistency with the rest of this page.
  const reviewsByChannel = {};
  reviewsByChannelAgg.forEach((r) => { reviewsByChannel[r._id] = r.count; });
  const byChannelTable = ['qr', 'whatsapp', 'email', 'sms'].map((ch) => {
    const sentCount    = byChannel[ch] || 0;
    const reviewsCount = reviewsByChannel[ch] || 0;
    return {
      channel: ch,
      sent: sentCount,
      reviews: reviewsCount,
      conversion_rate: sentCount > 0 ? parseFloat((reviewsCount / sentCount).toFixed(2)) : 0,
    };
  }).filter((row) => row.sent > 0 || row.reviews > 0);

  const avgDaysToReview = avgDaysToReviewAgg[0] && avgDaysToReviewAgg[0].avg != null
    ? parseFloat(avgDaysToReviewAgg[0].avg.toFixed(1))
    : null;

  return {
    avg_rating:          rs.avg_rating ? parseFloat(rs.avg_rating.toFixed(1)) : 0,
    total_requests_sent: totalRequests,
    total_requestees:    requesteesResult[0]?.count ?? 0,
    total_delivered:     deliveredCount,
    total_reviews:       rs.total,
    total_public:        rs.total_public,
    total_private:       rs.total_private,
    total_unresolved:    unresolvedCount,
    total_opened:        openedCount,
    conversion_rate:     totalRequests > 0
                           ? parseFloat((rs.total / totalRequests).toFixed(2))
                           : 0,
    by_channel:  byChannel,
    rating_breakdown: ratingBreakdown,
    by_channel_table: byChannelTable,
    avg_days_to_review: avgDaysToReview,
    prev_total_requests: prevTotalRequests,
    this_month: {
      total_reviews:  mtd.total,
      total_public:   mtd.total_public,
      total_private:  mtd.total_private,
    },
    last_month: {
      total_reviews:  lmtd.total,
      total_public:   lmtd.total_public,
      total_private:  lmtd.total_private,
    },
  };
};

// GET /api/analytics/summary?days=N  OR  ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
const getSummary = async (req, res) => {
  try {
    const data = await computeSummaryData(req);
    res.json({ data });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    throw err;
  }
};

// GET /api/analytics/reviews-over-time?days=N  OR  ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
const getReviewsOverTime = async (req, res) => {
  const filter = tenantFilter(req.user);

  // The deeper trend chart is the "Analytics" paid feature -- the basic
  // summary stats above (shared with the Dashboard) stay free regardless.
  if (req.user.role !== 'super_admin') {
    const myBusiness = await Business.findById(req.user.business_id).select('plan trial_ends_at plan_expires_at').lean();
    const myEffectivePlan = getEffectivePlanSlug(myBusiness);
    if (!(await canUseFeature(myEffectivePlan, 'analytics'))) {
      return lockedResponse(res, myBusiness, { kind: 'feature', feature: 'analytics' });
    }
  }

  let days, endDate;
  if (req.query.start_date && req.query.end_date) {
    const s = new Date(req.query.start_date);
    const e = new Date(req.query.end_date);
    if (isNaN(s) || isNaN(e) || s > e) {
      return res.status(400).json({ error: 'Invalid date range.' });
    }
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    days = Math.min(366, Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1));
    endDate = e;
  } else {
    days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 7, 366));
    endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
  }

  const slots = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    slots.push({
      date:     d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      dayStart: d.getTime(),
      google:   0,
      pvt:      0,
    });
  }

  const startDate = new Date(slots[0].dayStart);
  const reviews   = await Review.find({
    ...filter,
    created_at: { $gte: startDate },
  }).select('created_at is_public');

  for (const review of reviews) {
    const day = new Date(review.created_at);
    day.setHours(0, 0, 0, 0);
    const slot = slots.find(s => s.dayStart === day.getTime());
    if (slot) {
      if (review.is_public) slot.google++;
      else                  slot.pvt++;
    }
  }

  res.json({
    data: slots.map(s => ({ date: s.date, google: s.google, pvt: s.pvt })),
  });
};

// GET /api/analytics/qr-stats?days=N
const QR_TEMPLATE_LABELS = {
  table_tent:   'Table Tent',
  poster:       'Poster',
  sticker:      'Sticker',
  counter_card: 'Counter Card',
};

const pctChange = (current, prev) => {
  if (prev > 0) return Math.round(((current - prev) / prev) * 100);
  return current > 0 ? 100 : 0;
};

const getQrStats = async (req, res) => {
  const filter = tenantFilter(req.user);

  const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));
  const periodEnd = new Date();
  periodEnd.setHours(23, 59, 59, 999);
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - (days - 1));
  periodStart.setHours(0, 0, 0, 0);

  const prevEnd = new Date(periodStart.getTime() - 1);
  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - days);

  const qrReqFilter    = { ...filter, channel: 'qr' };
  const qrReviewFilter = { ...filter, source:  'qr' };

  const reviewGroup = {
    _id:           null,
    total:         { $sum: 1 },
    total_public:  { $sum: { $cond: [{ $eq: ['$is_public', true]  }, 1, 0] } },
    total_private: { $sum: { $cond: [{ $eq: ['$is_public', false] }, 1, 0] } },
    avg_rating:    { $avg: '$rating' },
  };

  const [
    totalScansAllTime,
    reviewStatsAllTime,
    periodScans,
    periodReviews,
    prevPeriodScans,
    prevPeriodReviews,
    scansByTemplate,
    reviewsByTemplate,
  ] = await Promise.all([
    ReviewRequest.countDocuments(qrReqFilter),
    Review.aggregate([{ $match: qrReviewFilter }, { $group: reviewGroup }]),
    ReviewRequest.countDocuments({ ...qrReqFilter, created_at: { $gte: periodStart, $lte: periodEnd } }),
    Review.aggregate([
      { $match: { ...qrReviewFilter, created_at: { $gte: periodStart, $lte: periodEnd } } },
      { $group: reviewGroup },
    ]),
    ReviewRequest.countDocuments({ ...qrReqFilter, created_at: { $gte: prevStart, $lte: prevEnd } }),
    Review.aggregate([
      { $match: { ...qrReviewFilter, created_at: { $gte: prevStart, $lte: prevEnd } } },
      { $group: reviewGroup },
    ]),
    ReviewRequest.aggregate([
      { $match: { ...qrReqFilter, created_at: { $gte: periodStart, $lte: periodEnd } } },
      { $group: { _id: '$qr_template', count: { $sum: 1 } } },
    ]),
    Review.aggregate([
      { $match: { ...qrReviewFilter, created_at: { $gte: periodStart, $lte: periodEnd } } },
      { $group: { _id: '$qr_template', count: { $sum: 1 } } },
    ]),
  ]);

  const rsAllTime = reviewStatsAllTime[0] || { total: 0, total_public: 0, total_private: 0, avg_rating: 0 };
  const rsPeriod  = periodReviews[0]      || { total: 0, total_public: 0, total_private: 0, avg_rating: 0 };
  const rsPrev    = prevPeriodReviews[0]  || { total: 0, total_public: 0, total_private: 0, avg_rating: 0 };

  const scanMap   = {};
  scansByTemplate.forEach(row => { scanMap[row._id || 'unlabeled'] = row.count; });
  const reviewMap = {};
  reviewsByTemplate.forEach(row => { reviewMap[row._id || 'unlabeled'] = row.count; });

  const byTemplate = [...Object.keys(QR_TEMPLATE_LABELS), 'unlabeled'].map(key => {
    const scans   = scanMap[key]   || 0;
    const reviews = reviewMap[key] || 0;
    return {
      key,
      label:           QR_TEMPLATE_LABELS[key] || 'Direct / Unlabeled',
      scans,
      reviews,
      conversion_rate: scans > 0 ? parseFloat((reviews / scans).toFixed(2)) : 0,
    };
  }).filter(row => row.scans > 0 || row.reviews > 0);

  const periodConversion = periodScans > 0 ? parseFloat((rsPeriod.total_public / periodScans).toFixed(2)) : 0;
  const prevConversion   = prevPeriodScans > 0 ? parseFloat((rsPrev.total_public / prevPeriodScans).toFixed(2)) : 0;

  res.json({
    data: {
      total_scans:     totalScansAllTime,
      total_reviews:   rsAllTime.total,
      total_public:    rsAllTime.total_public,
      total_private:   rsAllTime.total_private,
      avg_rating:      rsAllTime.avg_rating ? parseFloat(rsAllTime.avg_rating.toFixed(1)) : 0,
      conversion_rate: totalScansAllTime > 0 ? parseFloat((rsAllTime.total / totalScansAllTime).toFixed(2)) : 0,
      by_template:     byTemplate,
      period_days: days,
      period: {
        scans:           periodScans,
        feedback:        rsPeriod.total_private,
        reviews:         rsPeriod.total_public,
        conversion_rate: periodConversion,
      },
      period_change: {
        scans:           pctChange(periodScans, prevPeriodScans),
        feedback:        pctChange(rsPeriod.total_private, rsPrev.total_private),
        reviews:         pctChange(rsPeriod.total_public, rsPrev.total_public),
        conversion_rate: pctChange(periodConversion, prevConversion),
      },
    },
  });
};

// GET /api/analytics/export?days=N  OR  ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
// A real multi-section PDF report (Executive Overview, Review Funnel,
// Rating Breakdown, Channel Performance, Top Feedback Topics), branded with
// both ReviewBooster's own logo and the business's own name/logo/color.
// Gated like the trend chart above -- same "Analytics" paid feature, same
// reasoning: this is the deeper numbers, not the free headline stats.
const exportAnalyticsReport = async (req, res) => {
  let myBusiness = null;
  if (req.user.role !== 'super_admin') {
    myBusiness = await Business.findById(req.user.business_id).select('name brand_color brand_logo_url plan trial_ends_at plan_expires_at').lean();
    const myEffectivePlan = getEffectivePlanSlug(myBusiness);
    if (!(await canUseFeature(myEffectivePlan, 'analytics'))) {
      return lockedResponse(res, myBusiness, { kind: 'feature', feature: 'analytics' });
    }
  }

  let summary;
  try {
    summary = await computeSummaryData(req);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    throw err;
  }

  // Top Feedback Topics -- same real tag-count query as
  // GET /api/reviews/theme-summary, duplicated locally (a few lines) rather
  // than importing another controller's internal logic across files.
  const filter = tenantFilter(req.user);
  const days = (req.query.start_date && req.query.end_date)
    ? Math.max(1, Math.round((new Date(req.query.end_date) - new Date(req.query.start_date)) / (1000 * 60 * 60 * 24)) + 1)
    : Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));
  const since = new Date();
  since.setDate(since.getDate() - days);
  const themeBase = { ...filter, created_at: { $gte: since } };

  const [positiveAgg, negativeAgg] = await Promise.all([
    Review.aggregate([
      { $match: { ...themeBase, is_public: true } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Review.aggregate([
      { $match: { ...themeBase, is_public: false } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);
  const themeSummary = {
    positive: positiveAgg.map((r) => ({ label: r._id, count: r.count })),
    negative: negativeAgg.map((r) => ({ label: r._id, count: r.count })),
  };

  // Business's own logo (if set) -- fetched up front since PDF drawing is
  // synchronous. Skipped entirely for super_admin (no single business to
  // brand for when viewing cross-tenant data).
  let businessLogoBuffer = null;
  if (myBusiness && myBusiness.brand_logo_url) {
    businessLogoBuffer = await fetchImageBuffer(myBusiness.brand_logo_url);
  }

  const periodLabel = (req.query.start_date && req.query.end_date)
    ? ('Period: ' + req.query.start_date + ' to ' + req.query.end_date)
    : ('Last ' + days + ' days');

  // Summary paragraph -- plain-language recap of numbers already in
  // `summary`, nothing new computed. Opportunities below are the only
  // interpretive additions, and each is gated behind a real signal in the
  // data (a genuine channel gap, a real drop-off, an actual unresolved
  // count) -- never generic advice, and silently skipped when there's
  // nothing worth saying.
  const businessLabel = (myBusiness && myBusiness.name) ? myBusiness.name : 'This business';
  let summaryText = 'In the ' + periodLabel.toLowerCase() + ', ' + businessLabel + ' sent ' + summary.total_requests_sent +
    ' review request' + (summary.total_requests_sent === 1 ? '' : 's') + ' and collected ' + summary.total_reviews +
    ' review' + (summary.total_reviews === 1 ? '' : 's') + ' (' + Math.round((summary.conversion_rate || 0) * 100) + '% conversion). ' +
    summary.total_public + ' ' + (summary.total_public === 1 ? 'was' : 'were') + ' posted publicly to Google' +
    (summary.avg_rating ? ', with an average rating of ' + summary.avg_rating.toFixed(1) + ' out of 5.' : '.');

  const volTrend = (summary.this_month?.total_reviews ?? 0) - (summary.last_month?.total_reviews ?? 0);
  if (volTrend !== 0) {
    summaryText += volTrend > 0
      ? (' That\u2019s ' + volTrend + ' more than the previous period.')
      : (' That\u2019s ' + Math.abs(volTrend) + ' fewer than the previous period.');
  }

  const opportunities = [];
  const OPP_CHANNEL_LABELS = { qr: 'QR Code', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

  // 1. Channel conversion gap -- only compare channels with a real sample
  //    size, and only surface it if the gap is large enough to matter.
  const comparableChannels = (summary.by_channel_table || []).filter((r) => r.sent >= 5);
  if (comparableChannels.length >= 2) {
    const best  = comparableChannels.reduce((a, b) => (b.conversion_rate > a.conversion_rate ? b : a));
    const worst = comparableChannels.reduce((a, b) => (b.conversion_rate < a.conversion_rate ? b : a));
    const gapPts = Math.round((best.conversion_rate - worst.conversion_rate) * 100);
    if (gapPts >= 15) {
      opportunities.push(
        (OPP_CHANNEL_LABELS[best.channel] || best.channel) + ' converts at ' + Math.round(best.conversion_rate * 100) +
        '%, well above ' + (OPP_CHANNEL_LABELS[worst.channel] || worst.channel) + ' at ' + Math.round(worst.conversion_rate * 100) +
        '%. Sending more requests through ' + (OPP_CHANNEL_LABELS[best.channel] || best.channel) + ' could lift overall conversion.'
      );
    }
  }

  // 2. Biggest funnel drop-off, by raw count lost between consecutive stages.
  const funnelStages = [
    { label: 'Requests Sent',    value: summary.total_requests_sent || 0 },
    { label: 'Delivered',        value: summary.total_delivered || 0 },
    { label: 'Opened',           value: summary.total_opened || 0 },
    { label: 'Submitted',        value: summary.total_reviews || 0 },
    { label: 'Posted to Google', value: summary.total_public || 0 },
  ];
  let biggestDrop = null;
  for (let i = 1; i < funnelStages.length; i++) {
    const lost = funnelStages[i - 1].value - funnelStages[i].value;
    if (lost > 0 && (!biggestDrop || lost > biggestDrop.lost)) {
      biggestDrop = { from: funnelStages[i - 1].label, to: funnelStages[i].label, lost };
    }
  }
  if (biggestDrop && biggestDrop.lost >= 3) {
    opportunities.push(
      'Your biggest drop-off is between ' + biggestDrop.from + ' and ' + biggestDrop.to + ' \u2014 ' +
      biggestDrop.lost + ' request' + (biggestDrop.lost === 1 ? '' : 's') + " didn't continue past that step."
    );
  }

  // 3. Unresolved private feedback.
  if ((summary.total_unresolved || 0) > 0) {
    opportunities.push(
      summary.total_unresolved + ' piece' + (summary.total_unresolved === 1 ? '' : 's') + ' of private feedback ' +
      (summary.total_unresolved === 1 ? 'is' : 'are') + ' still unresolved.'
    );
  }

  // 4. Slow time-to-review.
  if (summary.avg_days_to_review != null && summary.avg_days_to_review >= 2) {
    opportunities.push(
      'Customers take an average of ' + summary.avg_days_to_review + ' days to leave a review after being asked \u2014 a faster follow-up window might help.'
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  sendAnalyticsReportPdf(res, {
    business: myBusiness,
    businessLogoBuffer,
    periodLabel,
    summary,
    themeSummary,
    summaryText,
    opportunities,
    filename: 'analytics-report-' + today + '.pdf',
  });
};

module.exports = { getSummary, getReviewsOverTime, getQrStats, exportAnalyticsReport };