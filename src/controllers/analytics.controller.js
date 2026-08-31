'use strict';
/**
 * analytics.controller.js
 * Aggregated stats for the dashboard overview page.
 * Session 17 — added last_month for trend indicators.
 * Session 18 fix — ?days param for rolling period on summary + chart.
 */
const Review        = require('../models/Review');
const ReviewRequest = require('../models/ReviewRequest');
const mongoose      = require('mongoose');

const tenantFilter = (user) => {
  if (user.role === 'super_admin') return {};
  return { business_id: new mongoose.Types.ObjectId(user.business_id) };
};

// GET /api/analytics/summary?days=N  (default 30, max 365)
const getSummary = async (req, res) => {
  const filter = tenantFilter(req.user);
  const days   = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));

  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - days);
  periodStart.setHours(0, 0, 0, 0);

  const prevEnd   = new Date(periodStart);
  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - days);
  prevStart.setHours(0, 0, 0, 0);

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
      { $match: filter },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]),
    Review.aggregate([
      { $match: filter },
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
    ReviewRequest.countDocuments({ ...filter, opened_at: { $ne: null } }),
    Review.countDocuments({ ...filter, is_public: false, resolved: false }),
    Review.aggregate([
      { $match: { ...filter, created_at: { $gte: periodStart } } },
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
      { $match: { ...filter, customer_id: { $ne: null } } },
      { $group: { _id: null, ids: { $addToSet: '$customer_id' } } },
      { $project: { count: { $size: '$ids' } } },
    ]),
    ReviewRequest.countDocuments({ ...filter, status: { $ne: 'failed' } }),
    Review.aggregate([
      { $match: { ...filter, created_at: { $gte: prevStart, $lt: prevEnd } } },
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

// GET /api/analytics/reviews-over-time?days=N  (default 7, max 90)
const getReviewsOverTime = async (req, res) => {
  const filter = tenantFilter(req.user);
  const days   = Math.max(7, Math.min(parseInt(req.query.days, 10) || 7, 90));
  const now    = new Date();

  const slots = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
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

// GET /api/analytics/qr-stats
const getQrStats = async (req, res) => {
  const filter = tenantFilter(req.user);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const lastMonthStart = new Date(monthStart);
  lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
  const lastMonthEnd = new Date(monthStart);

  const qrReqFilter    = { ...filter, channel: 'qr' };
  const qrReviewFilter = { ...filter, source:  'qr' };

  const [
    totalScans,
    reviewStats,
    thisMonthScans,
    thisMonthReviews,
    lastMonthScans,
    lastMonthReviews,
  ] = await Promise.all([
    ReviewRequest.countDocuments(qrReqFilter),
    Review.aggregate([
      { $match: qrReviewFilter },
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
    ReviewRequest.countDocuments({ ...qrReqFilter, created_at: { $gte: monthStart } }),
    Review.aggregate([
      { $match: { ...qrReviewFilter, created_at: { $gte: monthStart } } },
      {
        $group: {
          _id:          null,
          total:        { $sum: 1 },
          total_public: { $sum: { $cond: [{ $eq: ['$is_public', true] }, 1, 0] } },
        },
      },
    ]),
    ReviewRequest.countDocuments({ ...qrReqFilter, created_at: { $gte: lastMonthStart, $lt: lastMonthEnd } }),
    Review.aggregate([
      { $match: { ...qrReviewFilter, created_at: { $gte: lastMonthStart, $lt: lastMonthEnd } } },
      {
        $group: {
          _id:          null,
          total:        { $sum: 1 },
          total_public: { $sum: { $cond: [{ $eq: ['$is_public', true] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const rs   = reviewStats[0]      || { total: 0, total_public: 0, total_private: 0, avg_rating: 0 };
  const mtd  = thisMonthReviews[0] || { total: 0, total_public: 0 };
  const lmtd = lastMonthReviews[0] || { total: 0, total_public: 0 };

  res.json({
    data: {
      total_scans:     totalScans,
      total_reviews:   rs.total,
      total_public:    rs.total_public,
      total_private:   rs.total_private,
      avg_rating:      rs.avg_rating ? parseFloat(rs.avg_rating.toFixed(1)) : 0,
      conversion_rate: totalScans > 0 ? parseFloat((rs.total / totalScans).toFixed(2)) : 0,
      this_month: {
        total_scans:   thisMonthScans,
        total_reviews: mtd.total,
        total_public:  mtd.total_public,
      },
      last_month: {
        total_scans:   lastMonthScans,
        total_reviews: lmtd.total,
        total_public:  lmtd.total_public,
      },
    },
  });
};

module.exports = { getSummary, getReviewsOverTime, getQrStats };