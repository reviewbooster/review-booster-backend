'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * referral_settings collection
 * One document per business — the owner-editable text and rule for the
 * referral program. Kept as its own collection (rather than fields on
 * Business) so the whole referral feature stays self-contained.
 */
const ReferralSettingsSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
      unique: true,
    },
    // Shown to the referred friend (B) on the read-only landing page.
    // e.g. "Get 10% off your first visit"
    offer_text: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    // Handle only (e.g. "yoursalon") or a full URL — the landing page
    // normalizes either into a clickable link.
    instagram: {
      type: String,
      trim: true,
      maxlength: 150,
      default: null,
    },
    facebook: {
      type: String,
      trim: true,
      maxlength: 150,
      default: null,
    },
    // Anything else — website, YouTube, phone. Free text, shown as-is.
    other_contact: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
    // Deprecated — the single combined field used before address/instagram/
    // facebook/other_contact existed. No longer written to; kept only so
    // any pre-upgrade data can still be read once as a fallback.
    contact_info: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    // How many verified referrals earn the referrer (A) one reward.
    reward_threshold: {
      type: Number,
      min: 1,
      default: 3,
    },
    // What that reward is, e.g. "1 free haircut"
    reward_text: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ReferralSettingsSchema.index({ business_id: 1 }, { unique: true });

module.exports = mongoose.model('ReferralSettings', ReferralSettingsSchema);
