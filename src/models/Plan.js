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
      enum: ['trial', 'basic', 'pro', 'agency'],
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
      customers: { type: Number, default: null, min: 0 },
      staff:     { type: Number, default: null, min: 0 },
      ai_reply:  { type: Boolean, default: false },
      engine_a:  { type: Boolean, default: false },
      engine_b:  { type: Boolean, default: false },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

PlanSchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.model('Plan', PlanSchema);
