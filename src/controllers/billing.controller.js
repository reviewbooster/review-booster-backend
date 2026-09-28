'use strict';
/**
 * billing.controller.js
 * Manual UPI billing â€” no payment gateway. Business owners see plan
 * pricing + Adcend's UPI details and pay outside the app; a super_admin
 * manually activates the plan once they've confirmed the payment landed.
 * Kept deliberately simple until real payment-gateway billing is built.
 */
const Business                = require('../models/Business');
const Plan                    = require('../models/Plan');
const PlatformBillingSettings = require('../models/PlatformBillingSettings');
const BusinessReferralSettings = require('../models/BusinessReferralSettings');
const { logAction } = require('./auditLog.controller');
const Customer = require('../models/Customer');
const { clearPlanLimitsCache, FEATURE_LABELS, getEffectivePlanSlug, getPlanLimits, setTrialPlanCache } = require('../utils/planLimits');
const { getUsageCount, getReviewRequestCount } = require('../utils/usageMeter');

const PLAN_DEFAULTS = {
  trial:   { name: 'Trial',   sort: 0 },
  basic:   { name: 'Basic',   sort: 1 },
  pro:     { name: 'Pro',     sort: 2 },
  agency:  { name: 'Agency',  sort: 3 },
  // Not a real subscribable tier -- excluded from the customer-facing
  // purchasable list below. It's the feature set enforced the moment a
  // business's trial or paid plan lapses.
  expired: { name: 'Expired', sort: 4 },
  // -- New pricing tiers, being configured ahead of the actual cutover.
  // Kept out of the customer-facing list (see getPlans below) until the
  // migration is complete, so nothing half-finished reaches real business
  // owners in the meantime -- visible only in the Super Admin Plans page.
  free:    { name: 'Free',    sort: 5 },
  starter: { name: 'Starter', sort: 6 },
  growth:  { name: 'Growth',  sort: 7 },
};

// Builds the feature list shown to business owners straight from what's
// ticked in a plan's limits -- checked boxes first, then whatever extra
// marketing lines the admin typed in free text. Keeps the two in sync
// automatically instead of requiring the admin to type out ticked features
// by hand.
async function mergePlanFeatures(plan) {
  // Uses the same effective limits that enforcement uses (saved values if
  // the admin customized this plan, hardcoded defaults otherwise), so what
  // an owner reads on the card is exactly what the app enforces.
  const limits = await getPlanLimits(plan && plan.slug);
  const lines = [];
  const fmt = (n) => Number(n).toLocaleString('en-IN');
  const quota = (n, text) => {
    if (n === undefined || n === 0) return;           // not on this plan
    lines.push(n === Infinity ? 'Unlimited ' + text : fmt(n) + ' ' + text);
  };
  const hasNewQuotas = limits.review_requests !== undefined;

  if (hasNewQuotas) {
    quota(limits.review_requests, 'review requests/month');
    quota(limits.customers, 'customers stored');
    if (limits.staff !== undefined) {
      lines.push(limits.staff === Infinity ? 'Unlimited team members' : (limits.staff + 1) + ' team member' + (limits.staff + 1 === 1 ? '' : 's'));
    }
    quota(limits.sms, 'SMS/month');
    quota(limits.ai_replies, 'AI reply generations/month');
    quota(limits.follow_ups, 'follow-ups/month');
    quota(limits.win_back_contacts, 'win-back contacts/month');
    if (limits.locations) lines.push(limits.locations + ' location' + (limits.locations === 1 ? '' : 's'));
  }

  // Ticked features. AI replies and Win-Back are already shown above as
  // quotas on the new tiers, so they're skipped here to avoid duplicates.
  Object.keys(FEATURE_LABELS).forEach((key) => {
    if (hasNewQuotas && (key === 'ai_reply' || key === 'win_back')) return;
    if (limits[key]) lines.push(FEATURE_LABELS[key]);
  });

  return lines.concat((plan && plan.features) || []);
}

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
      // Race with another request creating the same docs â€” just re-read.
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
    trial_days: 14,
    trial_plan: 'growth',
  };
}

// GET /api/billing/plans â€” any authenticated user, active plans only
// Trial is never purchasable â€” it's assigned automatically at signup or
// manually by admin, so it's excluded here even though it's an editable
// "plan" entry in the admin Billing Settings screen.
const PUBLIC_PLAN_ORDER = ['free', 'starter', 'growth', 'pro'];

const getPlans = async (req, res) => {
  const all = await getOrCreateAllPlans();
  // Owners see exactly the four current tiers, in pricing-page order. The
  // legacy trial/basic/agency/expired rows stay in the admin list only.
  const visible = all
    .filter((p) => p.is_active && PUBLIC_PLAN_ORDER.includes(p.slug))
    .sort((a, b) => PUBLIC_PLAN_ORDER.indexOf(a.slug) - PUBLIC_PLAN_ORDER.indexOf(b.slug));
  const active = await Promise.all(visible.map(async (p) => {
    const obj = p.toObject ? p.toObject() : p;
    return Object.assign({}, obj, { features: await mergePlanFeatures(obj) });
  }));
  res.json({ data: active });
};

// GET /api/billing/my-status â€” any authenticated user with a business_id
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

  // Live "used vs. limit" for everything metered on the current plan. An
  // unlimited limit is Infinity server-side, which JSON turns into null --
  // the frontend reads null as "Unlimited", same convention as the Plans
  // admin page.
  const effectivePlan = getEffectivePlanSlug(business);
  const limits = await getPlanLimits(effectivePlan);
  const [reviewRequestsUsed, smsUsed, aiRepliesUsed, followUpsUsed, winBackUsed, customersUsed] = await Promise.all([
    getReviewRequestCount(business._id),
    getReviewRequestCount(business._id, 'sms'),
    getUsageCount(business._id, 'ai_reply'),
    getUsageCount(business._id, 'follow_up'),
    getUsageCount(business._id, 'win_back_contact'),
    Customer.countDocuments({ business_id: business._id }),
  ]);

  res.json({
    data: Object.assign({}, business, {
      effective_plan: effectivePlan,
      usage: {
        review_requests:   { used: reviewRequestsUsed, limit: limits.review_requests },
        sms:               { used: smsUsed,            limit: limits.sms },
        ai_replies:        { used: aiRepliesUsed,      limit: limits.ai_replies },
        follow_ups:        { used: followUpsUsed,      limit: limits.follow_ups },
        win_back_contacts: { used: winBackUsed,        limit: limits.win_back_contacts },
        customers:         { used: customersUsed,      limit: limits.customers },
      },
    }),
  });
};

// GET /api/billing/payment-info?plan=basic â€” owner or staff
// Everything the frontend needs to show a UPI QR + instructions for a
// specific plan: the plan's price, Adcend's UPI details, and a ready-made
// UPI deep link with the amount pre-filled.
const getPaymentInfo = async (req, res) => {
  const slug = req.query.plan;
  if (!PLAN_DEFAULTS[slug] || slug === 'expired' || slug === 'free') {
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
      plan: { slug: plan.slug, name: plan.name, price_monthly: displayPrice, original_price_monthly: plan.price_monthly, features: await mergePlanFeatures(plan) },
      referral_discount_applied,
      upi_id: settings.upi_id,
      upi_payee_name: settings.upi_payee_name,
      contact_whatsapp: settings.contact_whatsapp,
      instructions: settings.instructions,
      upi_uri,
    },
  });
};

// â”€â”€ Admin  -- 

// GET /api/admin/plans â€” super_admin, all plans (active + inactive)
const listPlansAdmin = async (req, res) => {
  // Only the four current tiers are editable here. The legacy
  // trial/basic/agency/expired rows still exist in the database but are
  // retired -- every business has been migrated off them.
  const all = (await getOrCreateAllPlans())
    .filter((p) => PUBLIC_PLAN_ORDER.includes(p.slug))
    .sort((a, b) => PUBLIC_PLAN_ORDER.indexOf(a.slug) - PUBLIC_PLAN_ORDER.indexOf(b.slug));
  // Overlay the limits the app actually enforces (saved values if the plan
  // was customized, built-in defaults otherwise) so the admin form never
  // prefills blank -- blank means "unlimited", and saving a card with blank
  // quotas would otherwise silently make that plan unlimited.
  const data = await Promise.all(all.map(async (p) => {
    const obj = p.toObject ? p.toObject() : p;
    const effective = await getPlanLimits(obj.slug);
    return Object.assign({}, obj, { limits: Object.assign({}, obj.limits, effective) });
  }));
  res.json({ data });
};

// PATCH /api/admin/plans/:slug â€” super_admin
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
    update['limits.win_back']         = !!limits.win_back;
    update['limits.analytics']        = !!limits.analytics;
    update['limits.custom_templates'] = !!limits.custom_templates;
    // Monthly quotas (blank = unlimited, 0 = not available on this plan)
    update['limits.review_requests']   = toLimit(limits.review_requests);
    update['limits.sms']               = toLimit(limits.sms);
    update['limits.ai_replies']        = toLimit(limits.ai_replies);
    update['limits.follow_ups']        = toLimit(limits.follow_ups);
    update['limits.win_back_contacts'] = toLimit(limits.win_back_contacts);
    // Locations is display-only for now, but it still has to save.
    var locs = parseInt(limits.locations, 10);
    update['limits.locations'] = (Number.isFinite(locs) && locs >= 1) ? locs : 1;
  }

  await getOrCreateAllPlans(); // ensure the doc exists before updating
  const plan = await Plan.findOneAndUpdate({ slug }, { $set: update }, { new: true, upsert: true });
  clearPlanLimitsCache(); // so this change takes effect immediately, not after the cache TTL
  await logAction(req, { action: 'billing.update_plan', target_type: 'Plan', target_label: slug, metadata: update });
  res.json({ data: plan });
};

// GET /api/admin/platform-settings â€” super_admin
const getPlatformSettingsAdmin = async (req, res) => {
  const settings = await getOrDefaultPlatformSettings();
  res.json({ data: settings });
};

// PATCH /api/admin/platform-settings â€” super_admin
const updatePlatformSettings = async (req, res) => {
  const { upi_id, upi_payee_name, contact_whatsapp, instructions, trial_days, trial_plan } = req.body;

  const update = {};
  if (upi_id !== undefined) update.upi_id = (upi_id || '').trim() || null;
  if (upi_payee_name !== undefined) update.upi_payee_name = (upi_payee_name || '').trim() || null;
  if (contact_whatsapp !== undefined) update.contact_whatsapp = (contact_whatsapp || '').trim() || null;
  if (instructions !== undefined) update.instructions = (instructions || '').trim().slice(0, 500) || null;
  if (trial_days !== undefined) {
    const n = parseInt(trial_days, 10);
    if (!Number.isFinite(n) || n < 1 || n > 90) {
      return res.status(400).json({ error: 'Trial length must be between 1 and 90 days.' });
    }
    update.trial_days = n;
  }
  if (trial_plan !== undefined) {
    if (['starter', 'growth', 'pro'].indexOf(trial_plan) === -1) {
      return res.status(400).json({ error: 'Trial plan must be Starter, Growth, or Pro.' });
    }
    update.trial_plan = trial_plan;
  }

  const settings = await PlatformBillingSettings.findOneAndUpdate(
    {},
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (update.trial_plan) setTrialPlanCache(update.trial_plan); // takes effect immediately
  await logAction(req, { action: 'billing.update_platform_settings', metadata: update });
  res.json({ data: settings });
};

// POST /api/admin/businesses/:id/activate-plan â€” super_admin
// Marks a business as paid on a given plan for N days, starting now.
// This is the manual step that replaces an automated payment webhook.
const activateBusinessPlan = async (req, res) => {
  const { id } = req.params;
  const { plan, days } = req.body;

  if (!PLAN_DEFAULTS[plan] || plan === 'expired') {
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

  // Extending a trial only moves the trial date -- it never changes the
  // business's actual plan, so they fall back to Free (not the retired
  // 'trial' value) when the extension ends.
  if (plan !== 'trial') business.plan = plan;
  if (plan === 'trial') {
    // Trial uses trial_ends_at, not plan_expires_at â€” and doesn't touch
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
