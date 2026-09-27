'use strict';
/**
 * planLimits.js
 * Feature/limit enforcement per plan. Reads super_admin-editable overrides
 * from the Plan collection (see models/Plan.js), falling back to these
 * hardcoded defaults for any plan that hasn't been customized yet — so
 * nothing changes in behavior until an admin explicitly edits and saves
 * limits in the Super Admin Plans page.
 *
 * A short in-memory cache avoids a DB round-trip on every single
 * customer-creation / staff-creation / AI-reply / redemption check.
 * clearPlanLimitsCache() is called by the admin update endpoint so edits
 * take effect immediately rather than waiting out the cache TTL.
 */
const Plan = require('../models/Plan');

const PLAN_LIMITS = {
  trial:   { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: false },
  basic:   { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: false },
  pro:     { customers: 1000,     staff: 3, ai_reply: true,  engine_a: true,  engine_b: false, win_back: true,  analytics: true,  custom_templates: true },
  agency:  { customers: Infinity, staff: Infinity, ai_reply: true, engine_a: true, engine_b: true, win_back: true, analytics: true, custom_templates: true },
  // A lapsed trial/paid plan falls back to this until the admin's own
  // Expired-tier settings (edited on the same Plans page) override it.
  expired: { customers: 0,        staff: 0, ai_reply: false, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: false },
};

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // plan slug -> { limits, expires }

// A limits sub-doc where every field is still at its schema default
// (null/null/false/false/false) means "never customized" — treat as absent.
function hasCustomLimits(limits) {
  if (!limits) return false;
  return !(
    limits.customers == null &&
    limits.staff == null &&
    !limits.ai_reply &&
    !limits.engine_a &&
    !limits.engine_b &&
    !limits.win_back &&
    !limits.analytics &&
    !limits.custom_templates
  );
}

function normalize(limits) {
  return {
    customers:        limits.customers == null ? Infinity : limits.customers,
    staff:            limits.staff == null ? Infinity : limits.staff,
    ai_reply:         !!limits.ai_reply,
    engine_a:         !!limits.engine_a,
    engine_b:         !!limits.engine_b,
    win_back:         !!limits.win_back,
    analytics:        !!limits.analytics,
    custom_templates: !!limits.custom_templates,
  };
}

async function getPlanLimits(plan) {
  const fallback = PLAN_LIMITS[plan] || PLAN_LIMITS.trial;

  const cached = cache.get(plan);
  if (cached && cached.expires > Date.now()) return cached.limits;

  let limits = fallback;
  try {
    const doc = await Plan.findOne({ slug: plan }).select('limits').lean();
    if (doc && hasCustomLimits(doc.limits)) {
      limits = normalize(doc.limits);
    }
  } catch (e) {
    limits = fallback; // DB hiccup — never fail a request over this
  }

  cache.set(plan, { limits, expires: Date.now() + CACHE_TTL_MS });
  return limits;
}

async function canUseFeature(plan, feature) {
  const limits = await getPlanLimits(plan);
  return !!limits[feature];
}

/**
 * Given a business doc with plan / trial_ends_at / plan_expires_at selected,
 * returns the plan slug to use for feature/limit checks: the business's
 * real plan, unless their trial or paid-plan window has actually lapsed --
 * in which case 'expired'. Computed live on every check (not a cron-driven
 * flag), so it's always accurate without ever needing to suspend the
 * account to enforce it.
 */
function getEffectivePlanSlug(business) {
  if (!business) return 'trial';
  const now = Date.now();
  if (business.plan === 'trial') {
    if (business.trial_ends_at && new Date(business.trial_ends_at).getTime() < now) {
      return 'expired';
    }
    return 'trial';
  }
  if (business.plan_expires_at && new Date(business.plan_expires_at).getTime() < now) {
    return 'expired';
  }
  return business.plan;
}

// Human-readable line for each boolean feature flag, in display order --
// shared by getPlans/getPaymentInfo (billing.controller.js) to build the
// feature list shown to business owners straight from what's ticked here,
// rather than needing it typed out separately.
const FEATURE_LABELS = {
  ai_reply:         'AI Reply Drafts',
  engine_a:         'Customer Referrals',
  engine_b:         'Refer a Business',
  win_back:         'Win-Back Campaigns',
  analytics:        'Advanced Analytics',
  custom_templates: 'Custom Message Templates',
};

function clearPlanLimitsCache() {
  cache.clear();
}

module.exports = { PLAN_LIMITS, FEATURE_LABELS, getPlanLimits, canUseFeature, getEffectivePlanSlug, clearPlanLimitsCache };