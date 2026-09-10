'use strict';
/**
 * public.controller.js
 * NO authentication -- hit by customers clicking review links.
 */
const nodeCrypto    = require('crypto');
const Business      = require('../models/Business');
const Customer      = require('../models/Customer');
const ReviewRequest = require('../models/ReviewRequest');
const Review        = require('../models/Review');
const Alert         = require('../models/Alert');
const User          = require('../models/User');
const StaffMember   = require('../models/StaffMember');
const { createNotification } = require('../utils/notificationHelper');
const { sendFeedbackAlertEmail } = require('../utils/mailer');
const { generateTags } = require('../utils/feedbackTagger');

// GET /api/r/:token
const validateToken = async (req, res) => {
  const request = await ReviewRequest.findOne({ unique_token: req.params.token })
    .populate('business_id', 'name google_review_url brand_logo_url')
    .populate('customer_id', 'name');

  if (!request) {
    return res.status(404).json({ error: 'This review link is invalid.' });
  }
  if (request.status === 'completed') {
    return res.status(410).json({ error: 'This review has already been submitted.' });
  }
  if (new Date() > new Date(request.expires_at)) {
    return res.status(410).json({ error: 'This review link has expired.' });
  }

  if (request.status === 'sent') {
    await ReviewRequest.updateOne(
      { _id: request._id },
      { $set: { status: 'opened', opened_at: new Date() } }
    );
  }

  res.json({
    data: {
      business_name:     request.business_id.name,
      google_review_url: request.business_id.google_review_url,
      logo_url:          request.business_id.brand_logo_url || null,
      customer_name:     request.customer_id ? request.customer_id.name : null,
      request_id:        request._id,
    },
  });
};

// POST /api/r/:token/submit
const submitReview = async (req, res) => {
  const { rating, feedback } = req.body;

  const request = await ReviewRequest.findOne({ unique_token: req.params.token });

  if (!request) {
    return res.status(404).json({ error: 'This review link is invalid.' });
  }
  if (request.status === 'completed') {
    return res.status(410).json({ error: 'Already submitted.' });
  }
  if (new Date() > new Date(request.expires_at)) {
    return res.status(410).json({ error: 'This review link has expired.' });
  }

  // 1-3 stars -- feedback is required
  if (rating <= 3 && !feedback) {
    return res.status(422).json({ error: 'Please tell us what went wrong so we can improve.' });
  }

  const isPublic = rating >= 4;

  const review = await Review.create({
    business_id:   request.business_id,
    customer_id:   request.customer_id,
    request_id:    request._id,
    rating,
    is_public:     isPublic,
    feedback_text: isPublic ? null : feedback,
    source:        request.channel,
    resolved:      false,
    tags:          isPublic ? [] : generateTags(feedback),
    qr_template:   request.qr_template || null,
    served_by:     request.served_by || null,
  });

  // Token used -- prevent resubmission
  await ReviewRequest.updateOne(
    { _id: request._id },
    { $set: { status: 'completed' } }
  );

  // Create alert for owner on low-star reviews
  if (!isPublic) {
    await Alert.create({
      business_id: request.business_id,
      review_id:   review._id,
      type:        'negative_review',
      message:     rating + '-star review received. Customer feedback requires attention.',
      seen:        false,
    });
  }

  // Notify business owner via notification system
  if (isPublic) {
    await createNotification({
      business_id: request.business_id,
      type:        'new_review',
      title:       'New Google Review',
      message:     rating + '-star review submitted - heading to Google!',
      entity_id:   review._id,
      entity_type: 'review',
    });
  } else {
    await createNotification({
      business_id: request.business_id,
      type:        'new_feedback',
      title:       'New Private Feedback',
      message:     rating + '-star feedback received - needs your attention',
      entity_id:   review._id,
      entity_type: 'feedback',
    });

    // Email alert -- reaches the owner even if the tab/app isn't open.
    // Never let a failed email crash the review submission itself.
    try {
      const [owner, business] = await Promise.all([
        User.findOne({ business_id: request.business_id, role: 'owner' }).select('name email'),
        Business.findById(request.business_id).select('name'),
      ]);
      if (owner && owner.email) {
        await sendFeedbackAlertEmail(owner.email, owner.name || 'there', business ? business.name : 'your business', rating, feedback);
      }
    } catch (err) {
      console.error('[Mailer] Failed to send feedback alert email:', err.message);
    }
  }

  res.status(201).json({
    data: {
      review_id:          review._id,
      is_public:          isPublic,
      redirect_to_google: isPublic,
    },
  });
};

// GET /api/r/qr/:qr_token
const QR_TEMPLATE_KEYS = ['table_tent', 'poster', 'sticker', 'counter_card'];

const getQrReview = async (req, res) => {
  const business = await Business.findOne({ qr_token: req.params.qr_token });
  if (!business) {
    return res.status(404).json({ error: 'Invalid QR code.' });
  }
  const unique_token = nodeCrypto.randomBytes(20).toString('hex');
  const expires_at   = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const rawTemplate  = typeof req.query.template === 'string' ? req.query.template.toLowerCase().trim() : null;
  const qr_template  = QR_TEMPLATE_KEYS.includes(rawTemplate) ? rawTemplate : null;

  // Staff-specific QR — each staff-directory member can have their own
  // sticker/QR (?staff=<id>) that auto-attributes the resulting review
  // request to them, with zero selection needed from anyone.
  let served_by = null;
  const rawStaffId = typeof req.query.staff === 'string' ? req.query.staff.trim() : null;
  if (rawStaffId) {
    const staffMember = await StaffMember.findOne({ _id: rawStaffId, business_id: business._id }).select('name').lean().catch(() => null);
    if (staffMember) served_by = staffMember.name;
  }

  await ReviewRequest.create({
    business_id: business._id,
    customer_id: null,
    unique_token,
    channel:     'qr',
    status:      'sent',
    expires_at,
    qr_template,
    served_by,
  });

  res.json({ data: { token: unique_token } });
};

// POST /api/r/:token/identify — optional name/phone capture for anonymous
// (mainly QR) requests. Skippable — the frontend simply won't call this if
// the customer chooses Skip.
const identifyCustomer = async (req, res) => {
  const { name, phone } = req.body;

  const request = await ReviewRequest.findOne({ unique_token: req.params.token });
  if (!request) {
    return res.status(404).json({ error: 'This review link is invalid.' });
  }
  if (request.status === 'completed') {
    return res.status(410).json({ error: 'This review has already been submitted.' });
  }
  if (request.customer_id) {
    // Already tied to a known customer (WhatsApp/SMS/Email requests) — nothing to do.
    return res.json({ data: { ok: true } });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  const E164 = /^\+[1-9]\d{6,14}$/;
  const cleanPhone = phone && phone.trim() ? phone.trim() : null;
  if (cleanPhone && !E164.test(cleanPhone)) {
    return res.status(400).json({ error: 'Phone must be a valid number, e.g. +919876543210' });
  }

  let customer = null;
  if (cleanPhone) {
    customer = await Customer.findOne({ business_id: request.business_id, phone: cleanPhone });
  }
  if (!customer) {
    customer = await Customer.create({
      business_id: request.business_id,
      name:        name.trim(),
      phone:       cleanPhone,
      tags:        ['qr_scan'],
    });
  }

  await ReviewRequest.updateOne({ _id: request._id }, { $set: { customer_id: customer._id } });

  res.json({ data: { ok: true } });
};

module.exports = { getQrReview, validateToken, submitReview, identifyCustomer };