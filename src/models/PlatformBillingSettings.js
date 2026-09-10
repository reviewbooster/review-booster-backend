'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * platform_billing_settings collection
 * A single document (not per-business) holding Adcend's own UPI payment
 * details, shown to any business owner who wants to upgrade. Manual
 * payment for now — no payment gateway involved. Super-admin editable.
 */
const PlatformBillingSettingsSchema = new Schema(
  {
    upi_id: {
      type: String,
      trim: true,
      default: null,
    },
    upi_payee_name: {
      type: String,
      trim: true,
      default: null,
    },
    contact_whatsapp: {
      type: String,
      trim: true,
      default: null,
    },
    instructions: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('PlatformBillingSettings', PlatformBillingSettingsSchema);