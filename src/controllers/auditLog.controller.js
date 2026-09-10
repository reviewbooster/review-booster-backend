'use strict';
/**
 * auditLog.controller.js
 * `logAction` is a plain helper other controllers import and call
 * inline — not middleware, so each call site stays explicit about what
 * it's logging. `getAuditLog` and `getBusinessDetail` are the two admin
 * read endpoints.
 */
const mongoose      = require('mongoose');
const AuditLog       = require('../models/AuditLog');
const Business       = require('../models/Business');
const User           = require('../models/User');
const Customer       = require('../models/Customer');
const Review         = require('../models/Review');
const BusinessReferral       = require('../models/BusinessReferral');
const BusinessReferralSignup = require('../models/BusinessReferralSignup');

// Fire-and-forget on purpose — a logging failure should never break the
// action it's describing.
async function logAction(req, { action, target_type, target_id, target_label, metadata }) {
  try {
    await AuditLog.create({
      actor_id: req.user?.id || null,
      actor_name: req.user?.name || null,
      actor_role: req.user?.role || null,
      action,
      target_type: target_type || null,
      target_id: target_id || null,
      target_label: target_label || null,
      metadata: metadata || null,
    });
  } catch (err) {
    console.error('[AuditLog] Failed to record action:', action, err.message);
  }
}

// GET /api/admin/audit-log — super_admin, most recent first
const getAuditLog = async (req, res) => {
  const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const skip  = (page - 1) * limit;

  const [total, entries] = await Promise.all([
    AuditLog.countDocuments({}),
    AuditLog.find({}).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  res.json({ data: entries, total, page, limit, pages: Math.ceil(total / limit) });
};

// GET /api/admin/businesses/:id/detail — super_admin
// Read-only rollup for the admin business list — everything about one
// business in one place instead of nothing.
const getBusinessDetail = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid business id.' });
  }

  const business = await Business.findById(id).lean();
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }

  const businessObjId = new mongoose.Types.ObjectId(id);

  const [owner, customerCount, publicReviewCount, privateFeedbackCount, unresolvedCount, referral, referralSignupCount, avgRatingAgg, staffCount] = await Promise.all([
    User.findOne({ business_id: id, role: 'owner' }).select('name email created_at').lean(),
    Customer.countDocuments({ business_id: id }),
    Review.countDocuments({ business_id: id, is_public: true }),
    Review.countDocuments({ business_id: id, is_public: false }),
    Review.countDocuments({ business_id: id, is_public: false, resolved: false }),
    BusinessReferral.findOne({ business_id: id }).lean(),
    BusinessReferralSignup.countDocuments({ referrer_business_id: id }),
    Review.aggregate([{ $match: { business_id: businessObjId } }, { $group: { _id: null, avg: { $avg: '$rating' } } }]),
    User.countDocuments({ business_id: id, role: 'staff' }),
  ]);

  const totalFeedback = privateFeedbackCount;
  const resolvedFeedback = totalFeedback - unresolvedCount;
  const resolutionRate = totalFeedback > 0 ? Math.round((resolvedFeedback / totalFeedback) * 100) : null;

  res.json({
    data: {
      business: {
        _id: business._id,
        name: business.name,
        type: business.type,
        plan: business.plan,
        trial_ends_at: business.trial_ends_at,
        plan_expires_at: business.plan_expires_at,
        is_suspended: business.is_suspended,
        created_at: business.created_at,
        referred_by_business_id: business.referred_by_business_id || null,
        referral_discount_used: !!business.referral_discount_used,
      },
      owner: owner ? { name: owner.name, email: owner.email, joined: owner.created_at } : null,
      customers: customerCount,
      staff_count: staffCount,
      reviews: {
        public: publicReviewCount,
        private: privateFeedbackCount,
        unresolved: unresolvedCount,
        avg_rating: avgRatingAgg[0] ? Math.round(avgRatingAgg[0].avg * 10) / 10 : null,
        resolution_rate: resolutionRate,
      },
      referrals: {
        own_code: referral ? referral.code : null,
        businesses_referred: referralSignupCount,
      },
    },
  });
};

// GET /api/admin/dashboard-stats — super_admin
// Real counts only — no invented MRR/ARR, since manual UPI billing can't
// reliably support that calculation yet.
const getDashboardStats = async (req, res) => {
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [
    totalBusinesses, trialBusinesses, suspendedBusinesses, paidBusinesses,
    totalCustomers, totalPublicReviews, totalPrivateFeedback, unresolvedFeedback,
    avgRatingAgg, pendingReferralCredits, expiringSoon,
    basicCount, proCount, agencyCount,
    viaReferralCount, selfSignupCount, adminCreatedCount, unknownSourceCount,
  ] = await Promise.all([
    Business.countDocuments({}),
    Business.countDocuments({ plan: 'trial', is_suspended: false }),
    Business.countDocuments({ is_suspended: true }),
    Business.countDocuments({ plan: { $ne: 'trial' }, is_suspended: false }),
    Customer.countDocuments({}),
    Review.countDocuments({ is_public: true }),
    Review.countDocuments({ is_public: false }),
    Review.countDocuments({ is_public: false, resolved: false }),
    Review.aggregate([{ $group: { _id: null, avg: { $avg: '$rating' } } }]),
    BusinessReferralSignup.countDocuments({ credited: false }),
    Business.countDocuments({
      is_suspended: false,
      $or: [
        { plan: 'trial', trial_ends_at: { $lte: soon, $gte: new Date() } },
        { plan: { $ne: 'trial' }, plan_expires_at: { $lte: soon, $gte: new Date() } },
      ],
    }),
    Business.countDocuments({ plan: 'basic', is_suspended: false }),
    Business.countDocuments({ plan: 'pro', is_suspended: false }),
    Business.countDocuments({ plan: 'agency', is_suspended: false }),
    Business.countDocuments({ source: 'self_signup', referred_by_business_id: { $ne: null } }),
    Business.countDocuments({ source: 'self_signup', referred_by_business_id: null }),
    Business.countDocuments({ source: 'admin_created' }),
    Business.countDocuments({ source: null }),
  ]);

  var conversionRate = totalPublicReviews + totalPrivateFeedback > 0
    ? Math.round((totalPublicReviews / (totalPublicReviews + totalPrivateFeedback)) * 1000) / 10
    : null;

  res.json({
    data: {
      businesses: {
        total: totalBusinesses,
        trial: trialBusinesses,
        paid: paidBusinesses,
        suspended: suspendedBusinesses,
        expiring_soon: expiringSoon,
      },
      subscriptions: { basic: basicCount, pro: proCount, agency: agencyCount },
      growth_sources: {
        via_referral: viaReferralCount,
        self_signup: selfSignupCount,
        admin_created: adminCreatedCount,
        unknown: unknownSourceCount,
      },
      customers: { total: totalCustomers },
      reviews: {
        public: totalPublicReviews,
        private: totalPrivateFeedback,
        unresolved: unresolvedFeedback,
        avg_rating: avgRatingAgg[0] ? Math.round(avgRatingAgg[0].avg * 10) / 10 : null,
        conversion_rate: conversionRate,
      },
      referrals: { pending_business_credits: pendingReferralCredits },
    },
  });
};

// GET /api/admin/needs-attention — super_admin
// Real, actionable items only — nothing here is invented. If a section
// would be empty, it's simply omitted; the frontend shows "all clear."
const getNeedsAttention = async (req, res) => {
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [expiringBusinesses, unresolvedAgg, pendingCredits] = await Promise.all([
    Business.find({
      is_suspended: false,
      $or: [
        { plan: 'trial', trial_ends_at: { $lte: soon, $gte: now } },
        { plan: { $ne: 'trial' }, plan_expires_at: { $lte: soon, $gte: now } },
      ],
    }).select('name plan trial_ends_at plan_expires_at').sort({ plan_expires_at: 1, trial_ends_at: 1 }).limit(10).lean(),

    Review.aggregate([
      { $match: { is_public: false, resolved: false } },
      { $group: { _id: '$business_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),

    BusinessReferralSignup.find({ credited: false })
      .populate('referrer_business_id', 'name')
      .populate('new_business_id', 'name')
      .sort({ created_at: 1 })
      .limit(10)
      .lean(),
  ]);

  const unresolvedBusinessIds = unresolvedAgg.map((r) => r._id);
  const unresolvedBusinesses = unresolvedBusinessIds.length
    ? await Business.find({ _id: { $in: unresolvedBusinessIds } }).select('name').lean()
    : [];
  const unresolvedNameMap = {};
  unresolvedBusinesses.forEach((b) => { unresolvedNameMap[String(b._id)] = b.name; });

  res.json({
    data: {
      expiring: expiringBusinesses.map((b) => {
        var isTrial = b.plan === 'trial';
        var expiryDate = isTrial ? b.trial_ends_at : b.plan_expires_at;
        var daysLeft = Math.ceil((new Date(expiryDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        return { business_id: b._id, business_name: b.name, plan: b.plan, days_left: daysLeft, expiry_date: expiryDate };
      }),
      unresolved_feedback: unresolvedAgg.map((r) => ({
        business_id: r._id,
        business_name: unresolvedNameMap[String(r._id)] || 'Unknown',
        count: r.count,
      })),
      pending_credits: pendingCredits.map((s) => ({
        signup_id: s._id,
        referrer_name: s.referrer_business_id ? s.referrer_business_id.name : 'Unknown',
        referred_name: s.new_business_id ? s.new_business_id.name : 'Unknown',
        created_at: s.created_at,
      })),
    },
  });
};

module.exports = { logAction, getAuditLog, getBusinessDetail, getDashboardStats, getNeedsAttention };
