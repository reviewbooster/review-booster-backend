'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * business_referral_settings collection
 * Engine B — a single platform-wide settings document (not per-business,
 * unlike Engine A's ReferralSettings). Controls what a referring business
 * is promised, and the one-time signup discount for the new business.
 * Fully admin-editable so pricing/rewards can change without a code change.
 */
const BusinessReferralSettingsSchema = new Schema(
  {
    // What the REFERRING business (A) is promised. Never auto-applied —
    // shown as a promise, then the admin manually credits it (e.g. extra
    // days on next activate-plan) and marks the signup as credited.
    referrer_reward_type: {
      type: String,
      enum: ['discount_pct', 'free_days', 'none'],
      default: 'discount_pct',
    },
    referrer_reward_value: {
      type: Number,
      default: 20,
      min: 0,
    },
    referrer_reward_text: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '20% off your next renewal for every business you refer.',
    },
    // What the NEW business (B) gets automatically shown on their first
    // plan's payment screen — a one-time % off, enforced only by what's
    // displayed (payment itself is still manual UPI).
    referred_discount_pct: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('BusinessReferralSettings', BusinessReferralSettingsSchema);
