'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * referrals collection
 * One record per customer per business — the code embedded in that
 * customer's personal referral link: /ref/:code
 *
 * Deliberately a brand-new, standalone collection. Nothing on the existing
 * Customer/Business models changes to support this.
 */
const ReferralSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    customer_id: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'customer_id is required'],
    },
    code: {
      type: String,
      required: [true, 'code is required'],
      unique: true,
    },
    /**
     * How many reward milestones (see ReferralSettings.reward_threshold)
     * have already been marked "given" for this customer. Compared against
     * floor(redeemed_count / threshold) to know if a new one is owed.
     */
    rewards_claimed: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Public link lookup — must be globally unique and fast
ReferralSchema.index({ code: 1 }, { unique: true });

// One referral record per customer per business; also used for dashboard listing
ReferralSchema.index({ business_id: 1, customer_id: 1 }, { unique: true });

module.exports = mongoose.model('Referral', ReferralSchema);
