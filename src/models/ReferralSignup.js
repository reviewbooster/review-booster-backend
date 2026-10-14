'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * referral_signups collection
 * One record per successful referral -- created only when a NEW customer
 * (not an existing one re-submitting) claims a referral link. This is
 * where attribution lives, kept fully separate from the Customer model
 * so nothing existing needs to change.
 *
 * location_id (added for the Owner Dashboard & Multi-Location spec):
 * which branch the redemption actually happened at -- captured from
 * whichever staff member checked the new customer in. The reward
 * program itself (threshold, reward text -- see ReferralSettings)
 * stays business-wide and is untouched by this field; this is purely
 * so "how many referrals came in through this branch" can be counted
 * per location in the Owner Dashboard, the same way Review/ReviewRequest
 * already carry location_id. Nullable: existing pre-migration records
 * and any future non-location-aware redemption path keep working.
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
    location_id: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
    },
    new_customer_id: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'new_customer_id is required'],
    },
    /**
     * Denormalized staff-directory name -- who redeemed this referral in
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

// Branch-scoped totals (Owner Dashboard per-location referral counts)
ReferralSignupSchema.index({ business_id: 1, location_id: 1 });

module.exports = mongoose.model('ReferralSignup', ReferralSignupSchema);
