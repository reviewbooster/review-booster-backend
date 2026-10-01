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
const SuccessStory  = require('../models/SuccessStory');
const SupportChat   = require('../models/SupportChat');
const BusinessReferralSignup = require('../models/BusinessReferralSignup');
const { getEffectivePlanSlug } = require('../utils/planLimits');

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
// Thresholds behind the Account Health badge -- named here so they're easy
// to find and tune. Only real, already-verified signals feed this (the same
// ones Needs Attention uses): expiry proximity, unresolved feedback volume,
// and incomplete onboarding. There's no login-tracking or usage-decline data
// to draw on yet, so those PDF-suggested signals aren't included.
const HEALTH_EXPIRING_AT_RISK_DAYS = 3;
const HEALTH_EXPIRING_WATCH_DAYS = 7;
const HEALTH_UNRESOLVED_AT_RISK = 5;
const HEALTH_ONBOARDING_STUCK_DAYS = 3;

function computeHealth(business, unresolvedCount, expiryDays) {
  var reasons = { at_risk: [], needs_attention: [] };

  if (expiryDays !== null) {
    if (expiryDays <= HEALTH_EXPIRING_AT_RISK_DAYS) {
      reasons.at_risk.push(expiryDays < 0 ? 'Plan/trial has expired' : 'Plan/trial expires in ' + expiryDays + ' day' + (expiryDays === 1 ? '' : 's'));
    } else if (expiryDays <= HEALTH_EXPIRING_WATCH_DAYS) {
      reasons.needs_attention.push('Plan/trial expires in ' + expiryDays + ' days');
    }
  }

  if (unresolvedCount > HEALTH_UNRESOLVED_AT_RISK) {
    reasons.at_risk.push(unresolvedCount + ' unresolved feedback items');
  } else if (unresolvedCount > 0) {
    reasons.needs_attention.push(unresolvedCount + ' unresolved feedback item' + (unresolvedCount === 1 ? '' : 's'));
  }

  var daysSinceSignup = Math.floor((Date.now() - new Date(business.created_at).getTime()) / (24 * 60 * 60 * 1000));
  if (business.onboarding_completed === false && daysSinceSignup >= HEALTH_ONBOARDING_STUCK_DAYS) {
    reasons.at_risk.push('Onboarding incomplete (' + daysSinceSignup + ' days since signup)');
  }

  var status = reasons.at_risk.length ? 'at_risk' : (reasons.needs_attention.length ? 'needs_attention' : 'healthy');
  return { status: status, reasons: reasons.at_risk.concat(reasons.needs_attention) };
}

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
        onboarding_completed: business.onboarding_completed,
        referred_by_business_id: business.referred_by_business_id || null,
        referral_discount_used: !!business.referral_discount_used,
      },
      health: computeHealth(
        business,
        unresolvedCount,
        (function () {
          var isTrial = business.plan === 'free' || business.plan === 'trial';
          var expiry = isTrial ? business.trial_ends_at : business.plan_expires_at;
          return expiry ? Math.ceil((new Date(expiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
        })()
      ),
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
  const now = new Date();

  // Trial model: a business is "on trial" while trial_ends_at is in the
  // future (stored plan is normally 'free'); a paid plan only counts as paid
  // until plan_expires_at passes -- after that they're effectively on Free.
  const PAID_PLANS = ['starter', 'growth', 'pro', 'basic', 'agency'];
  const paidValid = (plans) => ({
    plan: { $in: plans },
    is_suspended: false,
    $or: [{ plan_expires_at: null }, { plan_expires_at: { $gt: now } }],
  });

  const [
    totalBusinesses, trialBusinesses, suspendedBusinesses, paidBusinesses,
    totalCustomers, totalPublicReviews, totalPrivateFeedback, unresolvedFeedback,
    avgRatingAgg, pendingReferralCredits, expiringSoon,
    basicCount, proCount, agencyCount, freeCount, starterCount, growthCount,
    viaReferralCount, selfSignupCount, adminCreatedCount, unknownSourceCount,
  ] = await Promise.all([
    Business.countDocuments({}),
    Business.countDocuments({ plan: { $in: ['free', 'trial'] }, trial_ends_at: { $gt: now }, is_suspended: false }),
    Business.countDocuments({ is_suspended: true }),
    Business.countDocuments(paidValid(PAID_PLANS)),
    Customer.countDocuments({}),
    Review.countDocuments({ is_public: true }),
    Review.countDocuments({ is_public: false }),
    Review.countDocuments({ is_public: false, resolved: false }),
    Review.aggregate([{ $group: { _id: null, avg: { $avg: '$rating' } } }]),
    BusinessReferralSignup.countDocuments({ credited: false }),
    Business.countDocuments({
      is_suspended: false,
      $or: [
        { plan: { $in: ['free', 'trial'] }, trial_ends_at: { $lte: soon, $gte: now } },
        { plan: { $in: PAID_PLANS }, plan_expires_at: { $lte: soon, $gte: now } },
      ],
    }),
    Business.countDocuments(paidValid(['basic'])),
    Business.countDocuments(paidValid(['pro'])),
    Business.countDocuments(paidValid(['agency'])),
    // Free = stored as Free (or a paid plan that has lapsed) and not currently in a trial.
    Business.countDocuments({
      is_suspended: false,
      $and: [
        { $or: [{ plan: { $in: ['free', 'trial'] } }, { plan: { $in: PAID_PLANS }, plan_expires_at: { $lte: now } }] },
        { $or: [{ trial_ends_at: null }, { trial_ends_at: { $lte: now } }] },
      ],
    }),
    Business.countDocuments(paidValid(['starter'])),
    Business.countDocuments(paidValid(['growth'])),
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
      subscriptions: {
        free: freeCount, starter: starterCount, growth: growthCount, pro: proCount,
        // legacy tiers -- drop to zero once every business is migrated
        basic: basicCount, agency: agencyCount,
      },
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
  const ONBOARDING_STUCK_DAYS = 3;
  const stuckSince = new Date(Date.now() - ONBOARDING_STUCK_DAYS * 24 * 60 * 60 * 1000);

  const [expiringBusinesses, unresolvedAgg, pendingCredits, pendingStories, stuckOnboarding, supportWaiting] = await Promise.all([
    Business.find({
      is_suspended: false,
      $or: [
        { plan: { $in: ['free', 'trial'] }, trial_ends_at: { $lte: soon, $gte: now } },
        { plan: { $in: ['starter', 'growth', 'pro', 'basic', 'agency'] }, plan_expires_at: { $lte: soon, $gte: now } },
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

    SuccessStory.find({ status: { $in: ['submitted', 'under_review'] } })
      .populate('business_id', 'name')
      .sort({ submitted_at: 1 })
      .limit(10)
      .lean(),

    Business.find({ is_suspended: false, onboarding_completed: false, created_at: { $lte: stuckSince } })
      .select('name created_at')
      .sort({ created_at: 1 })
      .limit(10)
      .lean(),

    SupportChat.find({ status: 'open', unread_by_admin: true })
      .select('guest_name last_message_at')
      .sort({ last_message_at: 1 })
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
        var isTrial = b.plan === 'free' || b.plan === 'trial';
        var expiryDate = isTrial ? b.trial_ends_at : b.plan_expires_at;
        var daysLeft = Math.ceil((new Date(expiryDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        return { business_id: b._id, business_name: b.name, plan: b.plan, days_left: daysLeft, expiry_date: expiryDate };
      }),
      pending_stories: pendingStories.map((s) => ({
        story_id: s._id,
        business_id: s.business_id ? s.business_id._id : null,
        business_name: s.business_id ? s.business_id.name : 'Unknown',
        status: s.status,
        submitted_at: s.submitted_at,
      })),
      stuck_onboarding: stuckOnboarding.map((b) => {
        var daysStuck = Math.floor((now.getTime() - new Date(b.created_at).getTime()) / (24 * 60 * 60 * 1000));
        return { business_id: b._id, business_name: b.name, days_since_signup: daysStuck };
      }),
      support_waiting: supportWaiting.map((c) => ({
        chat_id: c._id,
        guest_name: c.guest_name,
        last_message_at: c.last_message_at,
      })),
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

// GET /api/admin/growth-trend -- new businesses per week, real counts from
// Business.created_at (no separate tracking table, nothing estimated).
const getGrowthTrend = async (req, res) => {
  const WEEKS = 8;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  var day = start.getDay(); // 0 = Sunday
  var sinceMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - sinceMonday - (WEEKS - 1) * 7);

  const businesses = await Business.find({ created_at: { $gte: start } }).select('created_at').lean();

  const buckets = [];
  for (let i = 0; i < WEEKS; i++) {
    buckets.push({ week_start: new Date(start.getTime() + i * 7 * 24 * 60 * 60 * 1000), count: 0 });
  }
  businesses.forEach((b) => {
    const idx = Math.floor((new Date(b.created_at).getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (idx >= 0 && idx < WEEKS) buckets[idx].count += 1;
  });

  res.json({ data: buckets });
};

// GET /api/admin/subscriptions -- super_admin
// Real per-business plan status only. No MRR, no failed-payment tracking --
// manual UPI billing has no gateway behind it, so there's nothing honest to
// compute there yet.
const getSubscriptions = async (req, res) => {
  const businesses = await Business.find({})
    .select('name plan plan_expires_at trial_ends_at is_suspended created_at')
    .lean();

  const now = Date.now();
  const rows = businesses.map((b) => {
    const effectivePlan = getEffectivePlanSlug(b);
    const onTrial = (b.plan === 'free' || b.plan === 'trial') &&
      b.trial_ends_at && new Date(b.trial_ends_at).getTime() > now;
    const renewalDate = onTrial ? b.trial_ends_at : b.plan_expires_at;
    const daysLeft = renewalDate
      ? Math.ceil((new Date(renewalDate).getTime() - now) / (24 * 60 * 60 * 1000))
      : null;
    const status = b.is_suspended ? 'suspended' : (onTrial ? 'trial' : effectivePlan);

    return {
      business_id: b._id,
      business_name: b.name,
      plan: effectivePlan,
      status: status,
      on_trial: onTrial,
      renewal_date: renewalDate,
      days_left: daysLeft,
      is_suspended: b.is_suspended,
      created_at: b.created_at,
    };
  });

  rows.sort((a, b) => {
    if (a.days_left == null && b.days_left == null) return 0;
    if (a.days_left == null) return 1;
    if (b.days_left == null) return -1;
    return a.days_left - b.days_left;
  });

  const counts = { trial: 0, free: 0, starter: 0, growth: 0, pro: 0, suspended: 0 };
  rows.forEach((r) => {
    if (r.is_suspended) { counts.suspended += 1; return; }
    if (r.on_trial) { counts.trial += 1; return; }
    if (counts[r.plan] !== undefined) counts[r.plan] += 1;
  });

  res.json({ data: { rows: rows, counts: counts } });
};

module.exports = { logAction, getAuditLog, getBusinessDetail, getDashboardStats, getNeedsAttention, getGrowthTrend, getSubscriptions };
