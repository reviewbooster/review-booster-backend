'use strict';
/**
 * public.controller.js
 * NO authentication -- hit by customers clicking review links.
 */
const nodeCrypto    = require('crypto');
const Business      = require('../models/Business');
const ReviewRequest = require('../models/ReviewRequest');
const Review        = require('../models/Review');
const Alert         = require('../models/Alert');
const { createNotification } = require('../utils/notificationHelper');

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
const getQrReview = async (req, res) => {
  const business = await Business.findOne({ qr_token: req.params.qr_token });
  if (!business) {
    return res.status(404).json({ error: 'Invalid QR code.' });
  }
  const unique_token = nodeCrypto.randomBytes(20).toString('hex');
  const expires_at   = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await ReviewRequest.create({
    business_id: business._id,
    customer_id: null,
    unique_token,
    channel:     'qr',
    status:      'sent',
    expires_at,
  });

  res.json({ data: { token: unique_token } });
};

module.exports = { getQrReview, validateToken, submitReview };