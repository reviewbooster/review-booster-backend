'use strict';
/**
 * billing.controller.js
 * Manual UPI billing — no payment gateway. Business owners see plan
 * pricing + Adcend's UPI details and pay outside the app; a super_admin
 * manually activates the plan once they've confirmed the payment landed.
 * Kept deliberately simple until real payment-gateway billing is built.
 */
const Business                = require('../models/Business');
const Plan                    = require('../models/Plan');
const PlatformBillingSettings = require('../models/PlatformBillingSettings');
const BusinessReferralSettings = require('../models/BusinessReferralSettings');
const { logAction } = require('./auditLog.controller');
const { clearPlanLimitsCache } = require('../utils/planLimits');

const PLAN_DEFAULTS = {
  trial:  { name: 'Trial',  sort: 0 },
  basic:  { name: 'Basic',  sort: 1 },
  pro:    { name: 'Pro',    sort: 2 },
  agency: { name: 'Agency', sort: 3 },
};

// Ensures all three plan docs exist (lazy-created with a $0 placeholder
// price the first time anyone asks), so the admin screen always has
// something to edit without needing a manual seed step.
async function getOrCreateAllPlans() {
  const existing = await Plan.find({});
  const bySlug = {};
  existing.forEach((p) => { bySlug[p.slug] = p; });

  const missing = Object.keys(PLAN_DEFAULTS).filter((slug) => !bySlug[slug]);
  if (missing.length > 0) {
    const created = await Plan.insertMany(
      missing.map((slug) => ({ slug, name: PLAN_DEFAULTS[slug].name })),
      { ordered: false }
    ).catch(async () => {
      // Race with another request creating the same docs — just re-read.
      return Plan.find({ slug: { $in: missing } });
    });
    (created || []).forEach((p) => { bySlug[p.slug] = p; });
  }

  return Object.keys(PLAN_DEFAULTS)
    .map((slug) => bySlug[slug])
    .filter(Boolean)
    .sort((a, b) => PLAN_DEFAULTS[a.slug].sort - PLAN_DEFAULTS[b.slug].sort);
}

async function getOrDefaultPlatformSettings() {
  const settings = await PlatformBillingSettings.findOne({}).lean();
  return settings || {
    upi_id: null,
    upi_payee_name: null,
    contact_whatsapp: null,
    instructions: null,
  };
}

// GET /api/billing/plans — any authenticated user, active plans only
// Trial is never purchasable — it's assigned automatically at signup or
// manually by admin, so it's excluded here even though it's an editable
// "plan" entry in the admin Billing Settings screen.
const getPlans = async (req, res) => {
  const all = await getOrCreateAllPlans();
  const active = all.filter((p) => p.is_active && p.slug !== 'trial');
  res.json({ data: active });
};

// GET /api/billing/my-status — any authenticated user with a business_id
const getMyBillingStatus = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const business = await Business.findById(req.user.business_id)
    .select('plan plan_expires_at trial_ends_at is_suspended')
    .lean();
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }
  res.json({ data: business });
};

// GET /api/billing/payment-info?plan=basic — owner or staff
// Everything the frontend needs to show a UPI QR + instructions for a
// specific plan: the plan's price, Adcend's UPI details, and a ready-made
// UPI deep link with the amount pre-filled.
const getPaymentInfo = async (req, res) => {
  const slug = req.query.plan;
  if (!PLAN_DEFAULTS[slug]) {
    return res.status(400).json({ error: 'Unknown plan.' });
  }
  const all = await getOrCreateAllPlans();
  const plan = all.find((p) => p.slug === slug);
  const settings = await getOrDefaultPlatformSettings();

  let displayPrice = plan.price_monthly;
  let referral_discount_applied = false;
  if (req.user.business_id) {
    const myBusiness = await Business.findById(req.user.business_id)
      .select('referred_by_business_id referral_discount_used').lean();
    if (myBusiness && myBusiness.referred_by_business_id && !myBusiness.referral_discount_used) {
      const bSettings = await BusinessReferralSettings.findOne({}).lean();
      const pct = bSettings ? bSettings.referred_discount_pct : 10;
      if (pct > 0 && displayPrice > 0) {
        displayPrice = Math.round(displayPrice * (1 - pct / 100));
        referral_discount_applied = true;
      }
    }
  }

  let upi_uri = null;
  if (settings.upi_id) {
    const params = new URLSearchParams({
      pa: settings.upi_id,
      pn: settings.upi_payee_name || 'ReviewBooster',
      cu: 'INR',
    });
    if (displayPrice > 0) params.set('am', String(displayPrice));
    upi_uri = 'upi://pay?' + params.toString();
  }

  res.json({
    data: {
      plan: { slug: plan.slug, name: plan.name, price_monthly: displayPrice, original_price_monthly: plan.price_monthly, features: plan.features },
      referral_discount_applied,
      upi_id: settings.upi_id,
      upi_payee_name: settings.upi_payee_name,
      contact_whatsapp: settings.contact_whatsapp,
      instructions: settings.instructions,
      upi_uri,
    },
  });
};

// ── Admin ──────────────────────────────────────────────────────────────

// GET /api/admin/plans — super_admin, all plans (active + inactive)
const listPlansAdmin = async (req, res) => {
  const all = await getOrCreateAllPlans();
  res.json({ data: all });
};

// PATCH /api/admin/plans/:slug — super_admin
const updatePlan = async (req, res) => {
  const { slug } = req.params;
  if (!PLAN_DEFAULTS[slug]) {
    return res.status(400).json({ error: 'Unknown plan.' });
  }
  const { name, price_monthly, features, is_active, limits } = req.body;

  const update = {};
  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Plan name cannot be empty.' });
    update.name = name.trim();
  }
  if (price_monthly !== undefined) {
    const n = Number(price_monthly);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: 'Price must be a number of 0 or more.' });
    }
    update.price_monthly = n;
  }
  if (features !== undefined) {
    update.features = Array.isArray(features) ? features.map((f) => String(f).trim()).filter(Boolean) : [];
  }
  if (is_active !== undefined) {
    update.is_active = !!is_active;
  }
  if (limits !== undefined && limits !== null) {
    var toLimit = function(v) {
      if (v === null || v === '' || v === undefined) return null;
      var n = Number(v);
      return (Number.isFinite(n) && n >= 0) ? n : null;
    };
    update['limits.customers'] = toLimit(limits.customers);
    update['limits.staff']     = toLimit(limits.staff);
    update['limits.ai_reply']  = !!limits.ai_reply;
    update['limits.engine_a']  = !!limits.engine_a;
    update['limits.engine_b']  = !!limits.engine_b;
  }

  await getOrCreateAllPlans(); // ensure the doc exists before updating
  const plan = await Plan.findOneAndUpdate({ slug }, { $set: update }, { new: true, upsert: true });
  clearPlanLimitsCache(); // so this change takes effect immediately, not after the cache TTL
  await logAction(req, { action: 'billing.update_plan', target_type: 'Plan', target_label: slug, metadata: update });
  res.json({ data: plan });
};

// GET /api/admin/platform-settings — super_admin
const getPlatformSettingsAdmin = async (req, res) => {
  const settings = await getOrDefaultPlatformSettings();
  res.json({ data: settings });
};

// PATCH /api/admin/platform-settings — super_admin
const updatePlatformSettings = async (req, res) => {
  const { upi_id, upi_payee_name, contact_whatsapp, instructions } = req.body;

  const update = {};
  if (upi_id !== undefined) update.upi_id = (upi_id || '').trim() || null;
  if (upi_payee_name !== undefined) update.upi_payee_name = (upi_payee_name || '').trim() || null;
  if (contact_whatsapp !== undefined) update.contact_whatsapp = (contact_whatsapp || '').trim() || null;
  if (instructions !== undefined) update.instructions = (instructions || '').trim().slice(0, 500) || null;

  const settings = await PlatformBillingSettings.findOneAndUpdate(
    {},
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await logAction(req, { action: 'billing.update_platform_settings', metadata: update });
  res.json({ data: settings });
};

// POST /api/admin/businesses/:id/activate-plan — super_admin
// Marks a business as paid on a given plan for N days, starting now.
// This is the manual step that replaces an automated payment webhook.
const activateBusinessPlan = async (req, res) => {
  const { id } = req.params;
  const { plan, days } = req.body;

  if (!PLAN_DEFAULTS[plan]) {
    return res.status(400).json({ error: 'Unknown plan.' });
  }
  const numDays = parseInt(days, 10);
  if (!Number.isFinite(numDays) || numDays < 1) {
    return res.status(400).json({ error: 'Days must be a number of at least 1.' });
  }

  const business = await Business.findById(id);
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }

  business.plan = plan;
  if (plan === 'trial') {
    // Trial uses trial_ends_at, not plan_expires_at — and doesn't touch
    // the Engine B discount flag, since no purchase is happening.
    business.trial_ends_at = new Date(Date.now() + numDays * 24 * 60 * 60 * 1000);
  } else {
    business.plan_expires_at = new Date(Date.now() + numDays * 24 * 60 * 60 * 1000);
    if (business.referred_by_business_id && !business.referral_discount_used) {
      business.referral_discount_used = true;
    }
  }
  business.is_suspended = false;
  await business.save();

  await logAction(req, {
    action: 'billing.activate_plan',
    target_type: 'Business',
    target_id: business._id,
    target_label: business.name,
    metadata: { plan, days: numDays },
  });

  res.json({
    data: {
      plan: business.plan,
      plan_expires_at: business.plan_expires_at,
      trial_ends_at: business.trial_ends_at,
      is_suspended: business.is_suspended,
    },
  });
};

module.exports = {
  getPlans,
  getMyBillingStatus,
  getPaymentInfo,
  listPlansAdmin,
  updatePlan,
  getPlatformSettingsAdmin,
  updatePlatformSettings,
  activateBusinessPlan,
};
