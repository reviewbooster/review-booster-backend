'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * reviews collection
 * Created when a customer submits a star rating via /r/:token/submit.
 * is_public = true  → 4 or 5 stars → owner shown Google redirect link
 * is_public = false → 1, 2, or 3 stars → private feedback, creates Alert
 */
const ReviewSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    /**
     * Null for anonymous QR-code reviews (Phase 3).
     */
    customer_id: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    request_id: {
      type: Schema.Types.ObjectId,
      ref: 'ReviewRequest',
      required: [true, 'request_id is required'],
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Minimum rating is 1'],
      max: [5, 'Maximum rating is 5'],
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be an integer',
      },
    },
    feedback_text: {
      type: String,
      trim: true,
      maxlength: [1000, 'Feedback cannot exceed 1000 characters'],
      default: null,
    },
    is_public: {
      type: Boolean,
      required: true,
      // Set in controller: rating >= 4 → true, else false
    },
    source: {
      type: String,
      required: true,
      enum: ['whatsapp', 'sms', 'email', 'qr'],
    },
    resolved: {
      type: Boolean,
      required: true,
      default: false,
    },
    /**
     * Progress tracking for private feedback BEFORE it's resolved.
     * `resolved` (above) remains the single source of truth for whether a
     * case is closed — this field is purely for showing where things stand
     * on the way there, so it's not read by any existing resolved-based
     * filters/indexes/analytics.
     */
    stage: {
      type: String,
      enum: ['new', 'processing', 'awaiting_confirmation'],
      default: 'new',
    },
    /**
     * Denormalized name (not a ref) so the resolution trail survives even if
     * the resolving user's account is later deleted.
     */
    resolved_by: {
      type: String,
      trim: true,
      default: null,
    },
    resolved_at: {
      type: Date,
      default: null,
    },
    /**
     * Free, keyword-based auto-tags for private feedback (e.g. "Staff",
     * "Wait Time"). Lets owners spot patterns without reading every entry.
     */
    tags: {
      type: [String],
      default: [],
    },
    /**
     * Cached Claude API response. Populated lazily on first
     * POST /reviews/:id/reply call, re-used on subsequent calls.
     */
    ai_reply_suggestion: {
      type: String,
      default: null,
    },
    /**
     * Denormalized from the originating ReviewRequest.qr_template so
     * per-template QR conversion stats don't need a populate/join.
     */
    qr_template: {
      type: String,
      default: null,
    },
    /**
     * Denormalized from the originating ReviewRequest.served_by — which
     * staff-directory name (if any) served this customer. Powers the
     * simple per-staff stats page. Null if attribution isn't used.
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

// Staff attribution stats aggregation
ReviewSchema.index({ business_id: 1, served_by: 1 });

// Primary tenant filter, sorted newest-first (dashboard + analytics)
ReviewSchema.index({ business_id: 1, created_at: -1 });

// Private feedback tab — unresolved complaints
ReviewSchema.index({ business_id: 1, is_public: 1, resolved: 1 });

// Analytics: weekly rating trend via aggregation
ReviewSchema.index({ business_id: 1, rating: 1, created_at: -1 });

module.exports = mongoose.model('Review', ReviewSchema);
