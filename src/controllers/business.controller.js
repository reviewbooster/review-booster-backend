'use strict';
/**
 * business.controller.js
 * Super-admin: list, delete businesses, reset passwords.
 * getMyQrToken: authenticated owner endpoint, no super_admin check.
 * getBusinessQr: super_admin can fetch/generate any business QR token.
 */
const nodeCrypto    = require('crypto');
const mongoose      = require('mongoose');
const Business      = require('../models/Business');
const User          = require('../models/User');
const Customer      = require('../models/Customer');
const ReviewRequest = require('../models/ReviewRequest');
const Review        = require('../models/Review');
const Alert         = require('../models/Alert');

// GET /api/business
const listBusinesses = async (req, res) => {
  const businesses = await Business.find({}).sort({ createdAt: -1 }).lean();
  res.json({ data: businesses });
};

// DELETE /api/business/:id
const deleteBusiness = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid business ID.' });
  }
  const business = await Business.findById(id);
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }
  await Promise.all([
    User.deleteMany({ business_id: id }),
    Customer.deleteMany({ business_id: id }),
    ReviewRequest.deleteMany({ business_id: id }),
    Review.deleteMany({ business_id: id }),
    Alert.deleteMany({ business_id: id }),
  ]);
  await Business.findByIdAndDelete(id);
  res.json({ data: { message: 'Business and all related data deleted.' } });
};

// POST /api/business/:id/reset-password
const resetBusinessPassword = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid business ID.' });
  }
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'new_password must be at least 8 characters.' });
  }
  const user = await User.findOne({ business_id: id, role: 'owner' });
  if (!user) {
    return res.status(404).json({ error: 'Owner account not found for this business.' });
  }
  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash(new_password, 12);
  await User.updateOne(
    { _id: user._id },
    {
      password_hash,
      must_change_password:     true,
      refresh_token_hash:       null,
      password_reset_requested: false,
    }
  );
  res.json({ data: { message: 'Password reset. Owner must change it on next login.', email: user.email } });
};

// GET /api/business/reset-requests
const getResetRequests = async (req, res) => {
  const users = await User.find({ password_reset_requested: true })
    .populate('business_id', 'name type')
    .select('name email role business_id created_at')
    .lean();
  res.json({ data: users });
};

// GET /api/business/my-qr — any authenticated user with a business_id
const getMyQrToken = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const business = await Business.findById(req.user.business_id)
    .select('qr_token name')
    .lean();
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }
  if (!business.qr_token) {
    const doc = await Business.findById(req.user.business_id);
    doc.qr_token = nodeCrypto.randomBytes(16).toString('hex');
    await doc.save();
    business.qr_token = doc.qr_token;
  }
  res.json({ data: { qr_token: business.qr_token, business_name: business.name } });
};

// GET /api/business/:id/qr — super_admin fetches any business QR token (auto-creates if missing)
const getBusinessQr = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid business ID.' });
  }
  const business = await Business.findById(id);
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }
  if (!business.qr_token) {
    business.qr_token = nodeCrypto.randomBytes(16).toString('hex');
    await business.save();
  }
  res.json({ data: { qr_token: business.qr_token, business_name: business.name } });
};

// PATCH /api/business/:id/google-url — super_admin only
const updateGoogleUrl = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid business ID.' });
  }
  const { google_review_url } = req.body;
  if (!google_review_url || !google_review_url.startsWith('https://')) {
    return res.status(400).json({ error: 'A valid Google review URL starting with https:// is required.' });
  }
  const business = await Business.findById(id);
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }
  business.google_review_url = google_review_url;
  await business.save();
  res.json({ data: { message: 'Google review URL updated.', google_review_url: business.google_review_url } });
};

// PATCH /api/business/:id/suspend -- super_admin only
const toggleSuspend = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid business ID.' });
  }
  const business = await Business.findById(id);
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }
  business.is_suspended = !business.is_suspended;
  await business.save();
  if (business.is_suspended) {
    await User.updateMany({ business_id: id }, { refresh_token_hash: null });
  }
  const action = business.is_suspended ? 'suspended' : 'enabled';
  res.json({ data: { message: 'Business ' + action + '.', is_suspended: business.is_suspended } });
};

// GET /api/business/my-settings - authenticated owner endpoint, no super_admin check
const getMySettings = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const business = await Business.findById(req.user.business_id)
    .select('name type google_review_url whatsapp_consent_required plan trial_ends_at')
    .lean();
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }
  res.json({ data: business });
};

// PATCH /api/business/my-settings - authenticated owner endpoint, no super_admin check
const updateMySettings = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const { name, google_review_url, whatsapp_consent_required } = req.body;

  const business = await Business.findById(req.user.business_id);
  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }

  if (name !== undefined) {
    if (!name.trim()) {
      return res.status(400).json({ error: 'Business name cannot be empty.' });
    }
    business.name = name.trim();
  }

  if (google_review_url !== undefined) {
    const trimmed = (google_review_url || '').trim();
    if (trimmed && !trimmed.startsWith('https://')) {
      return res.status(400).json({ error: 'Google review URL must start with https://.' });
    }
    business.google_review_url = trimmed || null;
  }

  if (whatsapp_consent_required !== undefined) {
    business.whatsapp_consent_required = !!whatsapp_consent_required;
  }

  await business.save();

  res.json({ data: {
    name: business.name,
    type: business.type,
    google_review_url: business.google_review_url,
    whatsapp_consent_required: business.whatsapp_consent_required,
    plan: business.plan,
    trial_ends_at: business.trial_ends_at,
  } });
};
module.exports = { listBusinesses, deleteBusiness, resetBusinessPassword, getResetRequests, getMyQrToken, getMySettings, updateMySettings, updateGoogleUrl, toggleSuspend, getBusinessQr };