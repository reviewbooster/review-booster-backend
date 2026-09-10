'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * referral_signups collection
 * One record per successful referral — created only when a NEW customer
 * (not an existing one re-submitting) claims a referral link. This is
 * where attribution lives, kept fully separate from the Customer model
 * so nothing existing needs to change.
 */
const ReferralSignupSchema = new Schema(
  {
    referral_id: {
      type: Schema.Types.ObjectId,
      ref: 'Referral',
      required: [true, 'referral_id is required'],
    },
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    new_customer_id: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'new_customer_id is required'],
    },
    /**
     * Denormalized staff-directory name — who redeemed this referral in
     * person. Same optional-attribution pattern as Review.served_by. Null
     * if attribution isn't used for this business.
     */
    redeemed_by: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Counting signups per referral (dashboard "X referred" number)
ReferralSignupSchema.index({ referral_id: 1 });

// Tenant-scoped totals
ReferralSignupSchema.index({ business_id: 1 });

module.exports = mongoose.model('ReferralSignup', ReferralSignupSchema);
