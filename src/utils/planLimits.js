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
  // -- Old tiers -- kept exactly as before; still what's actually enforced
  // for any business whose stored plan hasn't been migrated yet (Stage 3).
  trial:   { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: false },
  basic:   { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: false },
  agency:  { customers: Infinity, staff: Infinity, ai_reply: true, engine_a: true, engine_b: true, win_back: true, analytics: true, custom_templates: true },
  // A lapsed trial/paid plan falls back to this until the admin's own
  // Expired-tier settings (edited on the same Plans page) override it.
  expired: { customers: 0,        staff: 0, ai_reply: false, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: false },

  // -- New pricing tiers (matches the Pricing & Trial Guide PDF) -- quota
  // fields (review_requests/sms/ai_replies/follow_ups/win_back_contacts,
  // null = unlimited, 0 = unavailable) are configurable now but not yet
  // enforced anywhere -- that lands with the metering rollout's later
  // stage, alongside migrating existing businesses off the old tiers above.
  // ai_reply (boolean) is set alongside ai_replies (the real quota) since
  // that's still what current AI-reply enforcement actually reads -- every
  // tier gets *some* AI capacity per the PDF, so it's true across the board.
  free:    { customers: 100,   staff: 0,  review_requests: 25,  sms: 0,    ai_replies: 5,   follow_ups: 0,    win_back_contacts: 0,   ai_reply: true, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: false, locations: 1 },
  starter: { customers: 1000,  staff: 1,  review_requests: 150, sms: 50,   ai_replies: 25,  follow_ups: 50,   win_back_contacts: 0,   ai_reply: true, engine_a: false, engine_b: false, win_back: false, analytics: false, custom_templates: true,  locations: 1 },
  growth:  { customers: 5000,  staff: 4,  review_requests: 500, sms: 250,  ai_replies: 100, follow_ups: 250,  win_back_contacts: 100, ai_reply: true, engine_a: true,  engine_b: true,  win_back: true,  analytics: true,  custom_templates: true,  locations: 1 },
  // NOTE: this replaces the *fallback* numbers for the 'pro' slug with the
  // new PDF-defined Pro tier. If you've already customized a 'pro' Plan
  // document in the Super Admin Plans page, your saved values there keep
  // taking priority over this fallback either way, exactly as before --
  // this only changes what a never-yet-customized 'pro' plan defaults to.
  pro:     { customers: 25000, staff: 14, review_requests: 2000, sms: 1000, ai_replies: 500, follow_ups: 1000, win_back_contacts: 500, ai_reply: true, engine_a: true, engine_b: true, win_back: true, analytics: true, custom_templates: true, locations: 3 },
};

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // plan slug -> { limits, expires }

// A limits sub-doc where every field is still at its schema default
// means "never customized" — treat as absent.
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
    !limits.custom_templates &&
    limits.review_requests == null &&
    limits.sms == null &&
    limits.ai_replies == null &&
    limits.follow_ups == null &&
    limits.win_back_contacts == null
  );
}

function normalize(limits) {
  return {
    customers:         limits.customers == null ? Infinity : limits.customers,
    staff:             limits.staff == null ? Infinity : limits.staff,
    ai_reply:          !!limits.ai_reply,
    engine_a:          !!limits.engine_a,
    engine_b:          !!limits.engine_b,
    win_back:          !!limits.win_back,
    analytics:         !!limits.analytics,
    custom_templates:  !!limits.custom_templates,
    review_requests:   limits.review_requests == null ? Infinity : limits.review_requests,
    sms:               limits.sms == null ? Infinity : limits.sms,
    ai_replies:        limits.ai_replies == null ? Infinity : limits.ai_replies,
    follow_ups:        limits.follow_ups == null ? Infinity : limits.follow_ups,
    win_back_contacts: limits.win_back_contacts == null ? Infinity : limits.win_back_contacts,
    locations:         limits.locations == null ? 1 : limits.locations,
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
 * returns the plan slug to use for feature/limit checks.
 *
 * Trial-Free model: while trial_ends_at is still in the future, the
 * business always gets Growth-level access regardless of what `plan` is
 * actually stored as (normally 'free' during a trial, but this also
 * covers someone who upgrades mid-trial). Once the trial window closes,
 * or a paid plan's plan_expires_at lapses, they fall back to their real
 * stored plan -- which for anyone who never upgraded is 'free', a real,
 * permanent, always-available tier. There is no suspension and no
 * separate "expired" limbo state: falling back to Free *is* the fallback.
 *
 * 'trial' / 'expired' are kept as recognized inputs purely for any
 * business not yet migrated off the old tiers (see
 * migrate-plans-to-new-tiers.js) -- computed live on every check, never a
 * cron-driven flag, so it's always accurate.
 */
function getEffectivePlanSlug(business) {
  if (!business) return 'free';
  const now = Date.now();

  // Still within the trial window -- always Growth-level, regardless of
  // the stored plan.
  if (business.trial_ends_at && new Date(business.trial_ends_at).getTime() > now) {
    refreshTrialPlan();
    const trialPlan = trialPlanCache.slug;
    // Someone who has already paid for a tier above the trial's tier keeps
    // it during the trial instead of being pulled down.
    const paidActive = !business.plan_expires_at || new Date(business.plan_expires_at).getTime() > now;
    if (paidActive && (PLAN_RANK[business.plan] || 0) > (PLAN_RANK[trialPlan] || 0)) {
      return business.plan;
    }
    return trialPlan;
  }

  // Legacy 'trial' value with no trial window left: treat as the old
  // Expired fallback until this business is migrated.
  if (business.plan === 'trial') {
    return 'expired';
  }

  // A lapsed paid plan (Starter/Growth/Pro, or legacy Basic/Pro/Agency)
  // falls back to Free -- not suspended, not a separate limbo tier.
  if (business.plan_expires_at && new Date(business.plan_expires_at).getTime() < now) {
    return 'free';
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

// Which plan the free trial grants access to -- editable by the super admin
// (Billing Settings). getEffectivePlanSlug is synchronous, so the value is
// held in a small cache: refreshed in the background at most once a minute,
// and updated instantly when the admin saves the setting.
const PLAN_RANK = { free: 0, trial: 0, expired: 0, basic: 1, starter: 1, growth: 2, pro: 3, agency: 3 };
const trialPlanCache = { slug: 'growth', refreshAfter: 0 };

function refreshTrialPlan() {
  if (Date.now() < trialPlanCache.refreshAfter) return;
  trialPlanCache.refreshAfter = Date.now() + CACHE_TTL_MS;
  require('../models/PlatformBillingSettings')
    .findOne({}).select('trial_plan').lean()
    .then(function (s) { if (s && s.trial_plan) trialPlanCache.slug = s.trial_plan; })
    .catch(function () { /* keep the last known value */ });
}

function setTrialPlanCache(slug) {
  trialPlanCache.slug = slug || 'growth';
  trialPlanCache.refreshAfter = Date.now() + CACHE_TTL_MS;
}

module.exports = { PLAN_LIMITS, FEATURE_LABELS, getPlanLimits, canUseFeature, getEffectivePlanSlug, clearPlanLimitsCache, setTrialPlanCache };