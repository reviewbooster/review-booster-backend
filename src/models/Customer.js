'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * customers collection
 * End-customers of the local business — the people who receive review requests.
 */
const CustomerSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
      // E.164 format, e.g. +919876543210 — validated at route level with Joi
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
      // e.g. ['vip', 'follow-up']
    },
    whatsapp_consent: {
      type: Boolean,
      required: true,
      default: false,
    },
    opted_out: {
      type: Boolean,
      required: true,
      default: false,
    },
    last_contacted: {
      type: Date,
      default: null,
    },
    // Set (best-effort) when a win-back WhatsApp link is opened for this
    // customer. Used only to stop re-suggesting them every day -- see
    // winback.controller.js getDueCustomers.
    last_winback_sent: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'added_at', updatedAt: 'updated_at' },
  }
);

// Primary tenant filter — on every list query
CustomerSchema.index({ business_id: 1 });

// Duplicate phone check per tenant (see Section 5 — Duplicate prevention)
CustomerSchema.index({ business_id: 1, phone: 1 });

// Tag-based filtering for CRM / bulk sends
CustomerSchema.index({ business_id: 1, tags: 1 });

// Soft opt-out filter used in every send operation
CustomerSchema.index({ business_id: 1, opted_out: 1 });

module.exports = mongoose.model('Customer', CustomerSchema);
