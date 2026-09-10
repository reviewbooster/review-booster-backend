'use strict';
/**
 * businessReferral.controller.js
 * Engine B — businesses referring other businesses to ReviewBooster.
 * Same "system tracks, human fulfills" philosophy as everything else:
 * the only thing applied automatically is B's one-time signup discount
 * display. A's reward is always a manual admin action.
 */
const nodeCrypto             = require('crypto');
const Business                = require('../models/Business');
const BusinessReferral        = require('../models/BusinessReferral');
const BusinessReferralSignup  = require('../models/BusinessReferralSignup');
const BusinessReferralSettings = require('../models/BusinessReferralSettings');
const { logAction } = require('./auditLog.controller');
const { canUseFeature } = require('../utils/planLimits');

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function generateShortCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[nodeCrypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

async function getOrDefaultSettings() {
  const settings = await BusinessReferralSettings.findOne({}).lean();
  return settings || {
    referrer_reward_type: 'discount_pct',
    referrer_reward_value: 20,
    referrer_reward_text: '20% off your next renewal for every business you refer.',
    referred_discount_pct: 10,
  };
}

// Finds this business's own referral code, creating one on first request.
async function findOrCreateBusinessReferral(business_id) {
  let referral = await BusinessReferral.findOne({ business_id });
  if (referral) return referral;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await BusinessReferral.create({ business_id, code: generateShortCode() });
    } catch (err) {
      if (err.code !== 11000) throw err;
      referral = await BusinessReferral.findOne({ business_id });
      if (referral) return referral;
    }
  }
  throw new Error('Could not generate a unique business referral code.');
}

// GET /api/business-referrals/my-code — owner
const getMyCode = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  if (req.user.role !== 'super_admin') {
    const myBusiness = await Business.findById(business_id).select('plan').lean();
    if (!(await canUseFeature(myBusiness?.plan, 'engine_b'))) {
      return res.status(403).json({ error: 'Referring other businesses isn\u2019t available on your current plan. Upgrade to Agency to use this.' });
    }
  }
  const referral = await findOrCreateBusinessReferral(business_id);
  res.json({ data: { code: referral.code } });
};

// GET /api/business-referrals/my-stats — owner
const getMyStats = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  if (req.user.role !== 'super_admin') {
    const myBusiness = await Business.findById(business_id).select('plan').lean();
    if (!(await canUseFeature(myBusiness?.plan, 'engine_b'))) {
      return res.status(403).json({ error: 'Referring other businesses isn\u2019t available on your current plan. Upgrade to Agency to use this.' });
    }
  }
  const referral = await findOrCreateBusinessReferral(business_id);
  const signups = await BusinessReferralSignup.find({ referral_id: referral._id })
    .populate('new_business_id', 'name')
    .sort({ created_at: -1 })
    .lean();

  const settings = await getOrDefaultSettings();

  res.json({
    data: {
      code: referral.code,
      reward_text: settings.referrer_reward_text,
      total_referred: signups.length,
      pending_credits: signups.filter((s) => !s.credited).length,
      given_credits: signups.filter((s) => s.credited).length,
      referrals: signups.map((s) => ({
        business_name: s.new_business_id ? s.new_business_id.name : 'Unknown',
        credited: s.credited,
        created_at: s.created_at,
      })),
    },
  });
};

// GET /api/business-referrals/settings — public (shown on signup page)
const getPublicSettings = async (req, res) => {
  const settings = await getOrDefaultSettings();
  res.json({
    data: {
      referrer_reward_text: settings.referrer_reward_text,
      referred_discount_pct: settings.referred_discount_pct,
    },
  });
};

// GET /api/business-referrals/validate/:code — public, used by the signup
// page to show "Referred by X — Y% off your first plan" before they submit.
const validateCode = async (req, res) => {
  const referral = await BusinessReferral.findOne({ code: (req.params.code || '').toUpperCase().trim() })
    .populate('business_id', 'name');
  if (!referral || !referral.business_id) {
    return res.status(404).json({ error: 'Invalid referral code.' });
  }
  const settings = await getOrDefaultSettings();
  res.json({
    data: {
      referrer_name: referral.business_id.name,
      referred_discount_pct: settings.referred_discount_pct,
    },
  });
};

// ── Admin ──────────────────────────────────────────────────────────────

// GET /api/admin/business-referral-settings — super_admin
const getSettingsAdmin = async (req, res) => {
  const settings = await getOrDefaultSettings();
  res.json({ data: settings });
};

// PATCH /api/admin/business-referral-settings — super_admin
const updateSettingsAdmin = async (req, res) => {
  const { referrer_reward_type, referrer_reward_value, referrer_reward_text, referred_discount_pct } = req.body;

  const update = {};
  if (referrer_reward_type !== undefined) {
    if (!['discount_pct', 'free_days', 'none'].includes(referrer_reward_type)) {
      return res.status(400).json({ error: 'Invalid reward type.' });
    }
    update.referrer_reward_type = referrer_reward_type;
  }
  if (referrer_reward_value !== undefined) {
    const n = Number(referrer_reward_value);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: 'Reward value must be a number of 0 or more.' });
    }
    update.referrer_reward_value = n;
  }
  if (referrer_reward_text !== undefined) {
    update.referrer_reward_text = (referrer_reward_text || '').trim().slice(0, 300);
  }
  if (referred_discount_pct !== undefined) {
    const n = Number(referred_discount_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: 'Discount must be a number between 0 and 100.' });
    }
    update.referred_discount_pct = n;
  }

  const settings = await BusinessReferralSettings.findOneAndUpdate(
    {},
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await logAction(req, { action: 'business_referral.update_settings', metadata: update });
  res.json({ data: settings });
};

// GET /api/admin/business-referrals — super_admin — list all signups,
// pending ones first, so it's obvious who still needs to be credited.
const listSignupsAdmin = async (req, res) => {
  const signups = await BusinessReferralSignup.find({})
    .populate('referrer_business_id', 'name')
    .populate('new_business_id', 'name plan')
    .sort({ credited: 1, created_at: -1 })
    .lean();

  res.json({
    data: signups.map((s) => ({
      _id: s._id,
      referrer_name: s.referrer_business_id ? s.referrer_business_id.name : 'Unknown',
      referrer_business_id: s.referrer_business_id ? s.referrer_business_id._id : null,
      new_business_name: s.new_business_id ? s.new_business_id.name : 'Unknown',
      new_business_plan: s.new_business_id ? s.new_business_id.plan : null,
      credited: s.credited,
      credited_at: s.credited_at,
      created_at: s.created_at,
    })),
  });
};

// POST /api/admin/business-referrals/:id/mark-credited — super_admin
const markCreditedAdmin = async (req, res) => {
  const signup = await BusinessReferralSignup.findByIdAndUpdate(
    req.params.id,
    { $set: { credited: true, credited_at: new Date() } },
    { new: true }
  ).populate('referrer_business_id', 'name');
  if (!signup) {
    return res.status(404).json({ error: 'Referral signup not found.' });
  }
  await logAction(req, {
    action: 'business_referral.mark_credited',
    target_type: 'BusinessReferralSignup',
    target_id: signup._id,
    target_label: signup.referrer_business_id ? signup.referrer_business_id.name : null,
  });
  res.json({ data: { credited: signup.credited, credited_at: signup.credited_at } });
};

module.exports = {
  getMyCode,
  getMyStats,
  getPublicSettings,
  validateCode,
  getSettingsAdmin,
  updateSettingsAdmin,
  listSignupsAdmin,
  markCreditedAdmin,
};
