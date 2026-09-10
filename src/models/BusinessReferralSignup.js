'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * business_referral_signups collection
 * Engine B — one record per new business that signed up via another
 * business's referral link. "credited" tracks whether the admin has
 * manually given the referring business their reward yet — nothing here
 * is applied automatically, matching Engine A's manual-fulfillment model.
 */
const BusinessReferralSignupSchema = new Schema(
  {
    referral_id: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessReferral',
      required: [true, 'referral_id is required'],
    },
    referrer_business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'referrer_business_id is required'],
    },
    new_business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'new_business_id is required'],
      unique: true,
    },
    credited: {
      type: Boolean,
      default: false,
    },
    credited_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

BusinessReferralSignupSchema.index({ referrer_business_id: 1, credited: 1 });
BusinessReferralSignupSchema.index({ new_business_id: 1 }, { unique: true });

module.exports = mongoose.model('BusinessReferralSignup', BusinessReferralSignupSchema);
