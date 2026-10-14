'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * review_requests collection
 * One record per outbound message.  The unique_token is the key used in
 * the public review URL: /r/:token
 */
const ReviewRequestSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    /**
     * Phase 1 (Owner Dashboard & Multi-Location spec): which branch this
     * request belongs to. Stamped automatically for QR-sourced requests
     * (from the Location whose qr_token was scanned -- see
     * public.controller.js getQrReview). Null for requests sent before
     * this field existed, and for other channels until the owner's
     * send-flow becomes location-aware in a later phase. Never used to
     * leak data across branches -- always paired with business_id in
     * every tenant-scoped query.
     */
    location_id: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
    },
    /**
     * Null only for QR-code-sourced requests where the customer is anonymous
     * (Phase 3).  For all other channels, required.
     */
    customer_id: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    /**
     * UUID v4 — never reused, never predictable.
     * This is the token embedded in the short link sent to the customer.
     */
    unique_token: {
      type: String,
      required: [true, 'unique_token is required'],
    },
    channel: {
      type: String,
      required: true,
      enum: {
        values: ['whatsapp', 'sms', 'email', 'qr'],
        message: '{VALUE} is not a supported channel',
      },
    },
    status: {
      type: String,
      required: true,
      enum: ['sent', 'opened', 'completed', 'failed'],
      default: 'sent',
    },
    sent_at: {
      type: Date,
      default: () => new Date(),
    },
    opened_at: {
      type: Date,
      default: null,
    },
    reminder_sent: {
      type: Boolean,
      required: true,
      default: false,
    },
    expires_at: {
      type: Date,
      required: true,
      // Standard review requests expire in 7 days; QR requests get 90 days (set in controller)
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    /**
     * Which built-in QR print template this scan came from (e.g. 'table_tent',
     * 'poster', 'sticker', 'counter_card'). Null for non-QR channels and for
     * QR scans predating this field (the generic/shared link).
     */
    qr_template: {
      type: String,
      default: null,
    },
    /**
     * Denormalized staff-directory name (not a ref, same pattern as
     * resolved_by on Review) — "who served this customer". Set either by
     * the sender picking a name at send-time, or automatically when the
     * customer scans a staff-specific QR code. Null if attribution isn't
     * used for this business or wasn't picked.
     */
    served_by: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Primary tenant filter
ReviewRequestSchema.index({ business_id: 1 });

// Public URL token lookup — must be globally unique
ReviewRequestSchema.index({ unique_token: 1 }, { unique: true });

// Cron job query: opened requests older than 24h, not yet reminded
ReviewRequestSchema.index({ status: 1, reminder_sent: 1, sent_at: 1, expires_at: 1 });

// Per-customer "sent in last 30 days" duplicate-send check
ReviewRequestSchema.index({ business_id: 1, customer_id: 1, sent_at: -1 });

// Branch-level filtering (Phase 4/5: Overview, Analytics, Reviews per branch)
ReviewRequestSchema.index({ business_id: 1, location_id: 1, sent_at: -1 });

module.exports = mongoose.model('ReviewRequest', ReviewRequestSchema);
