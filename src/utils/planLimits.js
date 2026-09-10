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
  trial:  { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false },
  basic:  { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false },
  pro:    { customers: 1000,     staff: 3, ai_reply: true,  engine_a: true,  engine_b: false },
  agency: { customers: Infinity, staff: Infinity, ai_reply: true, engine_a: true, engine_b: true },
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
    !limits.engine_b
  );
}

function normalize(limits) {
  return {
    customers: limits.customers == null ? Infinity : limits.customers,
    staff:     limits.staff == null ? Infinity : limits.staff,
    ai_reply:  !!limits.ai_reply,
    engine_a:  !!limits.engine_a,
    engine_b:  !!limits.engine_b,
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

function clearPlanLimitsCache() {
  cache.clear();
}

module.exports = { PLAN_LIMITS, getPlanLimits, canUseFeature, clearPlanLimitsCache };