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
const mongoose      = require('mongoose');

const tenantFilter = (user) => {
  if (user.role === 'super_admin') return {};
  return { business_id: new mongoose.Types.ObjectId(user.business_id) };
};

// GET /api/analytics/summary?days=N  OR  ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
const getSummary = async (req, res) => {
  const filter = tenantFilter(req.user);

  let periodStart, periodEnd, days;
  if (req.query.start_date && req.query.end_date) {
    periodStart = new Date(req.query.start_date);
    periodEnd   = new Date(req.query.end_date);
    if (isNaN(periodStart) || isNaN(periodEnd) || periodStart > periodEnd) {
      return res.status(400).json({ error: 'Invalid date range.' });
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

  res.json({
    data: {
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
    },
  });
};

// GET /api/analytics/reviews-over-time?days=N  OR  ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
const getReviewsOverTime = async (req, res) => {
  const filter = tenantFilter(req.user);

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

module.exports = { getSummary, getReviewsOverTime, getQrStats };