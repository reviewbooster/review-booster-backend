'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * audit_logs collection
 * A record of sensitive admin actions — who did what, to which business,
 * when. Currently only wired up in the controllers Claude has directly
 * verified the true current content of (billing + Engine B admin
 * actions). Business suspend/delete/reset-password are NOT logged yet —
 * that lives in business.controller.js, which wasn't touched in this
 * session, so patching it blind was skipped rather than risk corrupting
 * an unverified file. Worth wiring up as a follow-up.
 */
const AuditLogSchema = new Schema(
  {
    actor_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actor_name: {
      type: String,
      trim: true,
      default: null,
    },
    actor_role: {
      type: String,
      trim: true,
      default: null,
    },
    action: {
      type: String,
      required: [true, 'action is required'],
      trim: true,
      // e.g. 'billing.activate_plan', 'billing.update_settings',
      // 'business_referral.mark_credited', 'business_referral.update_settings'
    },
    target_type: {
      type: String,
      trim: true,
      default: null,
      // e.g. 'Business', 'BusinessReferralSignup'
    },
    target_id: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    target_label: {
      type: String,
      trim: true,
      default: null,
      // denormalized human-readable label, e.g. a business name
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

AuditLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
