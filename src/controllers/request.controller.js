'use strict';

/**
 * request.controller.js
 * Send review requests via WhatsApp / SMS / Email.
 * Channel senders are stubbed — replace with Twilio + Nodemailer in Week 3.
 */

const nodeCrypto    = require('crypto');
const Customer      = require('../models/Customer');
const ReviewRequest = require('../models/ReviewRequest');
const Business      = require('../models/Business');

const tenantFilter = (user) => {
  if (user.role === 'super_admin') return {};
  return { business_id: user.business_id };
};

// Stubbed senders — swap in real integrations in Week 3 without touching anything else
const channelSenders = {
  whatsapp: async ({ customer, reviewUrl, businessName }) => {
    console.log(`[WHATSAPP] To: ${customer.phone} | ${businessName} | ${reviewUrl}`);
    // TODO: Twilio WhatsApp API
  },
  sms: async ({ customer, reviewUrl, businessName }) => {
    console.log(`[SMS] To: ${customer.phone} | ${businessName} | ${reviewUrl}`);
    // TODO: Twilio SMS API
  },
  email: async ({ customer, reviewUrl, businessName }) => {
    console.log(`[EMAIL] To: ${customer.email} | ${businessName} | ${reviewUrl}`);
    // TODO: Nodemailer (already installed — nodemailer ^8.0.7)
  },
};

// POST /api/requests
const sendRequest = async (req, res) => {
  const { customer_id, channel, served_by } = req.body;

  // Verify customer belongs to this business
  const customer = await Customer.findOne({ _id: customer_id, ...tenantFilter(req.user) });
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  // Check customer has the required contact info for the channel
  if (channel === 'email' && !customer.email) {
    return res.status(422).json({ error: 'This customer has no email address.' });
  }
  if ((channel === 'whatsapp' || channel === 'sms') && !customer.phone) {
    return res.status(422).json({ error: 'This customer has no phone number.' });
  }

  // Generate secure token — 64 hex chars (256-bit entropy)
  const token     = nodeCrypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const cleanServedBy = served_by && served_by.trim() ? served_by.trim() : null;

  const reviewRequest = await ReviewRequest.create({
    business_id: req.user.business_id,
    customer_id,
    unique_token: token,
    channel,
    status: 'sent',
    expires_at: expiresAt,
    served_by: cleanServedBy,
  });

  // Build public review URL for the message
  const reviewUrl    = `${process.env.FRONTEND_URL}/r/${token}`;
  const business     = await Business.findById(req.user.business_id).select('name');
  const businessName = business ? business.name : 'Us';

  await channelSenders[channel]({ customer, reviewUrl, businessName });

  res.status(201).json({ data: reviewRequest, review_url: reviewUrl });
};

// GET /api/requests
const listRequests = async (req, res) => {
  const { customer_id, channel, status, page, limit } = req.validatedQuery;
  const filter = tenantFilter(req.user);

  if (customer_id) filter.customer_id = customer_id;
  if (channel)     filter.channel     = channel;
  if (status)      filter.status      = status;

  const skip = (page - 1) * limit;
  const [total, requests] = await Promise.all([
    ReviewRequest.countDocuments(filter),
    ReviewRequest.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer_id', 'name phone email')
      .select('-__v'),
  ]);

  res.json({ data: requests, total, page, limit, pages: Math.ceil(total / limit) });
};

module.exports = { sendRequest, listRequests };