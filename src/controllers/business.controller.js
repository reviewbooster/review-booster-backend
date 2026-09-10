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
const { logAction } = require('./auditLog.controller');
const { getPlanLimits } = require('../utils/planLimits');

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
  await logAction(req, {
    action: 'business.delete',
    target_type: 'Business',
    target_id: id,
    target_label: business.name,
  });
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
  await logAction(req, {
    action: 'business.reset_password',
    target_type: 'Business',
    target_id: id,
    target_label: user.email,
  });
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
  await logAction(req, {
    action: business.is_suspended ? 'business.suspend' : 'business.enable',
    target_type: 'Business',
    target_id: id,
    target_label: business.name,
  });
  res.json({ data: { message: 'Business ' + action + '.', is_suspended: business.is_suspended } });
};

// GET /api/business/my-settings - authenticated owner endpoint, no super_admin check
const getMySettings = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const business = await Business.findById(req.user.business_id)
    .select('name type type_other google_review_url whatsapp_consent_required plan trial_ends_at brand_logo_url created_at message_templates')
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
  const { name, type, type_other, google_review_url, whatsapp_consent_required, message_templates } = req.body;

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

  if (type !== undefined) {
    const allowed = ['salon', 'barbershop', 'gym', 'dental', 'clinic', 'restaurant', 'retail', 'auto', 'real_estate', 'education', 'pet_care', 'other'];
    if (!allowed.includes(type)) {
      return res.status(400).json({ error: 'Invalid business type.' });
    }
    business.type = type;
    if (type === 'other') {
      if (type_other !== undefined) {
        if (!type_other || !type_other.trim()) {
          return res.status(400).json({ error: 'Please describe your business type.' });
        }
        business.type_other = type_other.trim().slice(0, 50);
      }
    } else {
      business.type_other = null;
    }
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

  if (message_templates !== undefined) {
    var mt = message_templates || {};
    if (mt.review_request !== undefined) {
      business.message_templates.review_request = (mt.review_request || '').trim() || null;
    }
    if (mt.thank_refer !== undefined) {
      business.message_templates.thank_refer = (mt.thank_refer || '').trim() || null;
    }
  }

  await business.save();

  res.json({ data: {
    name: business.name,
    type: business.type,
    type_other: business.type_other,
    google_review_url: business.google_review_url,
    whatsapp_consent_required: business.whatsapp_consent_required,
    plan: business.plan,
    trial_ends_at: business.trial_ends_at,
    brand_logo_url: business.brand_logo_url,
    message_templates: business.message_templates,
  } });
};

// POST /api/business/my-logo - authenticated owner endpoint, uploads to Cloudinary
const uploadMyLogo = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required.' });
  }
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowed.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are allowed.' });
  }

  const cloudinary = require('../config/cloudinary');
  const dataUri = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');

  const uploadResult = await cloudinary.uploader.upload(dataUri, {
    folder: 'reviewbooster/business-logos',
    public_id: String(req.user.business_id),
    overwrite: true,
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
  });

  const business = await Business.findByIdAndUpdate(
    req.user.business_id,
    { brand_logo_url: uploadResult.secure_url },
    { new: true }
  ).select('brand_logo_url');

  res.json({ data: { brand_logo_url: business.brand_logo_url } });
};
// GET /api/business/staff - owner only, lists staff accounts for their own business
const listStaff = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const staff = await User.find({ business_id: req.user.business_id, role: 'staff' })
    .select('name email created_at')
    .sort({ created_at: -1 });
  res.json({ data: staff });
};

// POST /api/business/staff - owner only, creates a staff account for their own business
const createStaff = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const { name, email, password } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const myBusiness = await Business.findById(req.user.business_id).select('plan').lean();
  const limits = await getPlanLimits(myBusiness?.plan);
  const currentStaffCount = await User.countDocuments({ business_id: req.user.business_id, role: 'staff' });
  if (currentStaffCount >= limits.staff) {
    return res.status(403).json({ error: limits.staff === 0
      ? 'Staff accounts aren\u2019t available on your current plan. Upgrade to add staff.'
      : 'You\u2019ve reached your plan\u2019s staff limit (' + limits.staff + '). Upgrade your plan to add more.' });
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    return res.status(409).json({ error: 'A user with that email already exists.' });
  }

  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash(password, 12);

  const staff = await User.create({
    business_id:           req.user.business_id,
    name:                  name.trim(),
    email:                 email.toLowerCase().trim(),
    password_hash,
    role:                  'staff',
    must_change_password:  true,
  });

  res.status(201).json({ data: { _id: staff._id, name: staff.name, email: staff.email, created_at: staff.created_at } });
};

// DELETE /api/business/staff/:id - owner only, removes a staff account from their own business
const deleteStaff = async (req, res) => {
  if (!req.user.business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const staff = await User.findOne({ _id: req.params.id, business_id: req.user.business_id, role: 'staff' });
  if (!staff) {
    return res.status(404).json({ error: 'Staff account not found.' });
  }
  await User.findByIdAndDelete(staff._id);
  res.json({ data: { message: 'Staff account removed.' } });
};

module.exports = { listBusinesses, deleteBusiness, resetBusinessPassword, getResetRequests, getMyQrToken, getMySettings, updateMySettings, uploadMyLogo, updateGoogleUrl, toggleSuspend, getBusinessQr, listStaff, createStaff, deleteStaff };