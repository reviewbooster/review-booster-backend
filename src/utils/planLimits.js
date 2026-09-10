'use strict';
/**
 * planLimits.js
 * Centralized plan feature/limit definitions — the ONE place that knows
 * what Basic/Pro/Agency (and trial) can do, so controllers ask this
 * instead of scattering `if (business.plan === 'pro')` checks everywhere.
 * Deliberately simple: a plain lookup table, not an entitlement engine.
 * Trial gets the same caps as Basic.
 */

const PLAN_LIMITS = {
  trial:  { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false },
  basic:  { customers: 200,      staff: 0, ai_reply: false, engine_a: false, engine_b: false },
  pro:    { customers: 1000,     staff: 3, ai_reply: true,  engine_a: true,  engine_b: false },
  agency: { customers: Infinity, staff: Infinity, ai_reply: true, engine_a: true, engine_b: true },
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.trial;
}

function canUseFeature(plan, feature) {
  const limits = getPlanLimits(plan);
  return !!limits[feature];
}

module.exports = { PLAN_LIMITS, getPlanLimits, canUseFeature };
