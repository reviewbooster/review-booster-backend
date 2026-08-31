'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * businesses collection
 * Top-level tenant record.  Every other collection references _id as business_id.
 */
const BusinessSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'Business type is required'],
      enum: {
        values: ['gym', 'salon', 'clinic', 'restaurant', 'other'],
        message: '{VALUE} is not a supported business type',
      },
    },
    google_review_url: {
      type: String,
      default: null,
      trim: true,
    },
    plan: {
      type: String,
      required: true,
      enum: ['trial', 'basic', 'pro', 'agency'],
      default: 'trial',
    },
    trial_ends_at: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    },
    brand_color: {
      type: String,
      trim: true,
      default: null,       // e.g. '#F97316'
    },
    brand_logo_url: {
      type: String,
      trim: true,
      default: null,
    },
    whatsapp_consent_required: {
      type: Boolean,
      default: true,
    },
    is_suspended: {
      type: Boolean,
      default: false,
    },
    approval_status: {
      type:    String,
      enum:    ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    qr_token: {
      type:    String,
      unique:  true,
      sparse:  true,
      default: () => require('crypto').randomBytes(16).toString('hex'),
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// No business_id here — this IS the root tenant. No compound index needed.
// We do want fast lookups by plan for admin dashboards.
BusinessSchema.index({ plan: 1 });
BusinessSchema.index({ is_suspended: 1 });
BusinessSchema.index({ approval_status: 1 });

module.exports = mongoose.model('Business', BusinessSchema);
