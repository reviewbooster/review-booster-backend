'use strict';
/**
 * referral.controller.js
 * Engine A referral program.
 *
 * Flow: a customer (A) gets a personal short code. A friend (B) opens A's
 * link and sees a read-only offer page — no online signup. B visits in
 * person and shows the code; staff verify it on the "Redeem a Referral"
 * screen, which is the only place attribution actually gets recorded.
 *
 * Self-contained: reads the existing Customer/Business models but never
 * modifies them.
 */
const mongoose         = require('mongoose');
const nodeCrypto      = require('crypto');
const Customer         = require('../models/Customer');
const Referral         = require('../models/Referral');
const ReferralSignup   = require('../models/ReferralSignup');
const ReferralSettings = require('../models/ReferralSettings');
const Business         = require('../models/Business');
const { canUseFeature } = require('../utils/planLimits');

const E164 = /^\+[1-9]\d{6,14}$/;

// Mongoose does NOT auto-cast plain strings to ObjectId inside aggregate()
// $match stages (unlike find()/countDocuments()). req.user.business_id comes
// off the JWT as a plain string, so every aggregate below needs this cast —
// otherwise the $match silently matches nothing.
function toObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

// Short, hard-to-mistype codes for staff to key in at checkout.
// Excludes 0/O and 1/I/L to avoid confusion when read aloud or handwritten.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function generateShortCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[nodeCrypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// Finds a customer's referral, creating one with a fresh short code if
// this is the first time. Retries a handful of times on the (very rare)
// chance of a code collision.
async function findOrCreateReferral(business_id, customer_id) {
  let referral = await Referral.findOne({ business_id, customer_id });
  if (referral) return referral;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await Referral.create({ business_id, customer_id, code: generateShortCode() });
    } catch (err) {
      if (err.code !== 11000) throw err; // not a duplicate-key race, rethrow
      referral = await Referral.findOne({ business_id, customer_id });
      if (referral) return referral;
      // else: code collision — loop and try a new one
    }
  }
  throw new Error('Could not generate a unique referral code after several attempts.');
}

// Case-insensitive code matching — codes created before this fix were
// stored lowercase (old hex format); new ones are uppercase. Match either.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function codeQuery(rawCode) {
  const clean = (rawCode || '').trim();
  return { $regex: new RegExp('^' + escapeRegex(clean) + '$', 'i') };
}

async function getOrDefaultSettings(business_id) {
  const settings = await ReferralSettings.findOne({ business_id }).lean();
  const base = settings || {
    offer_text: null,
    address: null,
    instagram: null,
    facebook: null,
    other_contact: null,
    reward_threshold: 3,
    reward_text: null,
  };

  // One-time fallback: if this business saved contact info before the
  // address/instagram/facebook split existed, parse the old combined
  // field so it still shows up, without needing a hard migration.
  const hasStructured = base.address || base.instagram || base.facebook || base.other_contact;
  if (!hasStructured && base.contact_info) {
    return { ...base, ...parseLegacyContactInfo(base.contact_info) };
  }
  return base;
}

// Parses the old single-string contact_info format into the newer
// structured fields. Only used as a read-time fallback for pre-upgrade data.
function parseLegacyContactInfo(text) {
  const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const address = [];
  let instagram = null;
  let facebook = null;
  const other = [];
  let pastLabeled = false;

  lines.forEach((line) => {
    const lower = line.toLowerCase();
    if (lower.indexOf('instagram') === 0) {
      instagram = line.replace(/^instagram\s*[-:]\s*/i, '').trim();
      pastLabeled = true;
    } else if (lower.indexOf('facebook') === 0) {
      facebook = line.replace(/^facebook\s*[-:]\s*/i, '').trim();
      pastLabeled = true;
    } else if (lower.indexOf('address') === 0) {
      address.push(line.replace(/^address\s*[-:]\s*/i, '').trim());
    } else if (!pastLabeled) {
      address.push(line);
    } else {
      other.push(line);
    }
  });

  return {
    address: address.join(', ') || null,
    instagram,
    facebook,
    other_contact: other.join('\n') || null,
  };
}

// GET /api/referrals/settings — owner or staff (view-only)
const getMySettings = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const settings = await getOrDefaultSettings(business_id);
  res.json({ data: settings });
};

// PATCH /api/referrals/settings — owner only
const updateMySettings = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const { offer_text, address, instagram, facebook, other_contact, reward_threshold, reward_text } = req.body;

  const update = {};
  if (offer_text     !== undefined) update.offer_text     = (offer_text     || '').trim().slice(0, 300) || null;
  if (address         !== undefined) update.address         = (address         || '').trim().slice(0, 200) || null;
  if (instagram       !== undefined) update.instagram       = (instagram       || '').trim().slice(0, 150) || null;
  if (facebook        !== undefined) update.facebook        = (facebook        || '').trim().slice(0, 150) || null;
  if (other_contact   !== undefined) update.other_contact   = (other_contact   || '').trim().slice(0, 300) || null;
  if (reward_text     !== undefined) update.reward_text     = (reward_text     || '').trim().slice(0, 300) || null;
  if (reward_threshold !== undefined) {
    const n = parseInt(reward_threshold, 10);
    if (!Number.isFinite(n) || n < 1) {
      return res.status(400).json({ error: 'Referrals needed for a reward must be a number of at least 1.' });
    }
    update.reward_threshold = n;
  }

  const settings = await ReferralSettings.findOneAndUpdate(
    { business_id },
    { $set: update, $setOnInsert: { business_id } },
    { upsert: true, new: true }
  );
  res.json({ data: settings });
};

// GET /api/referrals/:code — PUBLIC, no auth
// The read-only landing page a referred friend (B) sees. No customer is
// created here — this is informational only.
const getReferralLanding = async (req, res) => {
  const referral = await Referral.findOne({ code: codeQuery(req.params.code) })
    .populate('business_id', 'name brand_logo_url')
    .populate('customer_id', 'name');

  if (!referral || !referral.business_id) {
    return res.status(404).json({ error: 'This referral code is invalid.' });
  }

  const settings = await getOrDefaultSettings(referral.business_id._id);

  res.json({
    data: {
      code:          referral.code,
      business_name: referral.business_id.name,
      logo_url:      referral.business_id.brand_logo_url || null,
      referrer_name: referral.customer_id ? referral.customer_id.name : null,
      offer_text:    settings.offer_text,
      address:       settings.address,
      instagram:     settings.instagram,
      facebook:      settings.facebook,
      other_contact: settings.other_contact,
    },
  });
};

// GET /api/referrals/lookup/:code — owner or staff
// Step 1 of redemption: confirm the code is real and show who it belongs
// to before staff enter the new customer's details.
const lookupReferralCode = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }

  const referral = await Referral.findOne({ business_id, code: codeQuery(req.params.code) })
    .populate('customer_id', 'name');
  if (!referral) {
    return res.status(404).json({ error: 'No customer has this referral code.' });
  }

  const redeemedCount = await ReferralSignup.countDocuments({ referral_id: referral._id });
  const settings = await getOrDefaultSettings(business_id);

  res.json({
    data: {
      code:             referral.code,
      referrer_customer_id: referral.customer_id ? referral.customer_id._id : null,
      referrer_name:    referral.customer_id ? referral.customer_id.name : 'Unknown',
      redeemed_count:   redeemedCount,
      reward_threshold: settings.reward_threshold,
    },
  });
};

// POST /api/referrals/redeem — owner or staff
// Step 2: staff enter B's details in person. This is the moment
// attribution is actually recorded.
const redeemReferral = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }

  if (req.user.role !== 'super_admin') {
    const myBusiness = await Business.findById(business_id).select('plan').lean();
    if (!(await canUseFeature(myBusiness?.plan, 'engine_a'))) {
      return res.status(403).json({ error: 'Customer referrals aren\u2019t available on your current plan. Upgrade to Pro or Agency to use this.' });
    }
  }

  const { code, name, phone, email, redeemed_by } = req.body;
  const cleanRedeemedBy = redeemed_by && redeemed_by.trim() ? redeemed_by.trim() : null;

  const referral = await Referral.findOne({ business_id, code: codeQuery(code) });
  if (!referral) {
    return res.status(404).json({ error: 'No customer has this referral code.' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const cleanPhone = phone && phone.trim() ? phone.trim() : null;
  if (cleanPhone && !E164.test(cleanPhone)) {
    return res.status(400).json({ error: 'Phone must be a valid number, e.g. +919876543210' });
  }
  const cleanEmail = email && email.trim() ? email.trim() : null;

  let customer = null;
  if (cleanPhone) {
    customer = await Customer.findOne({ business_id, phone: cleanPhone });
  }

  let isNew = false;
  if (!customer) {
    customer = await Customer.create({
      business_id,
      name:  name.trim(),
      phone: cleanPhone,
      email: cleanEmail,
      tags:  ['referral'],
    });
    isNew = true;
  }

  const isSelfReferral = String(customer._id) === String(referral.customer_id);
  if (!isNew) {
    return res.status(409).json({ error: 'This person is already an existing customer — not counted as a new referral.' });
  }
  if (isSelfReferral) {
    return res.status(409).json({ error: 'This code belongs to the same customer — can\u2019t refer themselves.' });
  }

  await ReferralSignup.create({
    referral_id:     referral._id,
    business_id,
    new_customer_id: customer._id,
    redeemed_by:     cleanRedeemedBy,
  });

  const redeemedCount = await ReferralSignup.countDocuments({ referral_id: referral._id });
  const settings = await getOrDefaultSettings(business_id);
  const earned = Math.floor(redeemedCount / settings.reward_threshold);
  const unclaimed = earned - (referral.rewards_claimed || 0);

  res.status(201).json({
    data: {
      ok: true,
      new_customer_id: customer._id,
      redeemed_count:  redeemedCount,
      reward_threshold: settings.reward_threshold,
      reward_just_earned: unclaimed > 0,
    },
  });
};

// GET /api/referrals/rewards — owner or staff
// Only customers who have crossed a reward milestone they haven't been
// given yet. Deliberately NOT a full customer list.
const listRewardsEarned = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const settings = await getOrDefaultSettings(business_id);

  const referrals = await Referral.find({ business_id }).populate('customer_id', 'name phone').lean();
  const counts = await ReferralSignup.aggregate([
    { $match: { business_id: toObjectId(business_id) } },
    { $group: { _id: '$referral_id', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  counts.forEach((c) => { countMap[String(c._id)] = c.count; });

  const rewards = referrals
    .map((r) => {
      const redeemedCount = countMap[String(r._id)] || 0;
      const earned    = Math.floor(redeemedCount / settings.reward_threshold);
      const unclaimed = earned - (r.rewards_claimed || 0);
      return {
        customer_id:    r.customer_id ? r.customer_id._id : null,
        customer_name:  r.customer_id ? r.customer_id.name : 'Unknown',
        redeemed_count: redeemedCount,
        unclaimed_rewards: unclaimed,
      };
    })
    .filter((r) => r.unclaimed_rewards > 0 && r.customer_id)
    .sort((a, b) => b.unclaimed_rewards - a.unclaimed_rewards);

  res.json({ data: rewards, reward_text: settings.reward_text, reward_threshold: settings.reward_threshold });
};

// POST /api/referrals/rewards/:customer_id/claim — owner only
const markRewardGiven = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const referral = await Referral.findOne({ business_id, customer_id: req.params.customer_id });
  if (!referral) {
    return res.status(404).json({ error: 'No referral record for this customer.' });
  }
  referral.rewards_claimed = (referral.rewards_claimed || 0) + 1;
  await referral.save();
  res.json({ data: { rewards_claimed: referral.rewards_claimed } });
};

// GET /api/referrals/customer/:customer_id — owner or staff
// Used by the "Thank + Refer" button on the Reviews page.
const getCustomerReferral = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const customer = await Customer.findOne({ _id: req.params.customer_id, business_id }).select('_id');
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found.' });
  }
  const referral = await findOrCreateReferral(business_id, customer._id);
  res.json({ data: { code: referral.code } });
};

// GET /api/referrals/stats — owner or staff (used by both the Dashboard
// summary card and the Referrals page's own stat-card row).
const getReferralStats = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const settings = await getOrDefaultSettings(business_id);
  const totalReferred = await ReferralSignup.countDocuments({ business_id });

  const referrals = await Referral.find({ business_id }).lean();
  const counts = await ReferralSignup.aggregate([
    { $match: { business_id: toObjectId(business_id) } },
    { $group: { _id: '$referral_id', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  counts.forEach((c) => { countMap[String(c._id)] = c.count; });

  let activeReferrers = 0;
  let rewardsGiven = 0;
  let rewardsPending = 0;
  referrals.forEach((r) => {
    const count = countMap[String(r._id)] || 0;
    if (count > 0) activeReferrers++;
    rewardsGiven += (r.rewards_claimed || 0);
    const earned = Math.floor(count / settings.reward_threshold);
    const unclaimed = earned - (r.rewards_claimed || 0);
    if (unclaimed > 0) rewardsPending += unclaimed;
  });

  res.json({
    data: {
      total_redeemed:   totalReferred,
      active_referrers: activeReferrers,
      rewards_given:    rewardsGiven,
      rewards_pending:  rewardsPending,
    },
  });
};

// GET /api/referrals/referrers — owner or staff
// Every customer who has referred at least one person, with their point
// total — a plain leaderboard, separate from the "needs action" rewards list.
const listReferrers = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const referrals = await Referral.find({ business_id }).populate('customer_id', 'name').lean();
  const counts = await ReferralSignup.aggregate([
    { $match: { business_id: toObjectId(business_id) } },
    { $group: { _id: '$referral_id', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  counts.forEach((c) => { countMap[String(c._id)] = c.count; });

  const referrers = referrals
    .map((r) => ({
      customer_id:     r.customer_id ? r.customer_id._id : null,
      customer_name:   r.customer_id ? r.customer_id.name : 'Unknown',
      points:          countMap[String(r._id)] || 0,
      rewards_claimed: r.rewards_claimed || 0,
    }))
    .filter((r) => r.points > 0 && r.customer_id)
    .sort((a, b) => b.points - a.points);

  res.json({ data: referrers });
};

module.exports = {
  getMySettings,
  updateMySettings,
  getReferralLanding,
  lookupReferralCode,
  redeemReferral,
  listRewardsEarned,
  markRewardGiven,
  getCustomerReferral,
  getReferralStats,
  listReferrers,
};
