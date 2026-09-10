'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * business_referrals collection
 * Engine B — one short code per business, used to refer OTHER businesses
 * to ReviewBooster. Same short-code pattern as Engine A's customer
 * Referral model, but scoped to businesses referring businesses.
 */
const BusinessReferralSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
      unique: true,
    },
    code: {
      type: String,
      required: [true, 'code is required'],
      unique: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

BusinessReferralSchema.index({ code: 1 }, { unique: true });
BusinessReferralSchema.index({ business_id: 1 }, { unique: true });

module.exports = mongoose.model('BusinessReferral', BusinessReferralSchema);
