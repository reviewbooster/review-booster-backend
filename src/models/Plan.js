'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * plans collection
 * Editable pricing/feature info for display on the Billing page. Deliberately
 * keyed to the same three slugs already used in Business.plan ('basic',
 * 'pro', 'agency') rather than introducing a separate tier system — so
 * nothing about how plans are assigned to a business needs to change, only
 * what price/features get shown for each one. The owner (super_admin) edits
 * these directly; no code change needed when real pricing is decided.
 */
const PlanSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      // 'expired' isn't a real subscribable tier -- it's the feature set a
      // business falls back to the moment its trial or paid plan lapses.
      // Configurable on the same admin Plans page as everything else.
      // 'free' / 'starter' / 'growth' are the new pricing-tier names being
      // phased in -- 'trial' / 'basic' / 'agency' / 'expired' stay in the
      // enum until the migration to the new tiers is complete (see
      // planLimits.js), so existing businesses never hit an invalid plan
      // value mid-rollout.
      enum: ['trial', 'basic', 'pro', 'agency', 'expired', 'free', 'starter', 'growth'],
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price_monthly: {
      type: Number,
      default: 0,
      min: 0,
    },
    features: {
      type: [String],
      default: [],
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    /**
     * Actual feature/limit enforcement for this plan, editable by
     * super_admin. Null on customers/staff means unlimited. If this whole
     * object is unset (legacy plan docs created before this existed),
     * utils/planLimits.js falls back to its hardcoded defaults so nothing
     * changes in behavior until an admin explicitly edits and saves here.
     */
    limits: {
      customers:         { type: Number, default: null, min: 0 },
      staff:             { type: Number, default: null, min: 0 },
      ai_reply:          { type: Boolean, default: false },
      engine_a:          { type: Boolean, default: false },
      engine_b:          { type: Boolean, default: false },
      win_back:          { type: Boolean, default: false },
      analytics:         { type: Boolean, default: false },
      custom_templates:  { type: Boolean, default: false },
      // -- New PDF-matching monthly quotas (null = unlimited, 0 = unavailable) --
      review_requests:   { type: Number, default: null, min: 0 },
      sms:               { type: Number, default: null, min: 0 },
      ai_replies:        { type: Number, default: null, min: 0 },
      follow_ups:        { type: Number, default: null, min: 0 },
      win_back_contacts: { type: Number, default: null, min: 0 },
      // Display-only for now -- there is no multi-location feature in the
      // app yet, so this is not enforced anywhere. Purely informational
      // until (if) real multi-location support gets built.
      locations:         { type: Number, default: 1, min: 1 },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

PlanSchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.model('Plan', PlanSchema);
