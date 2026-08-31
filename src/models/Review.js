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
     * Cached Claude API response. Populated lazily on first
     * POST /reviews/:id/reply call, re-used on subsequent calls.
     */
    ai_reply_suggestion: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Primary tenant filter, sorted newest-first (dashboard + analytics)
ReviewSchema.index({ business_id: 1, created_at: -1 });

// Private feedback tab — unresolved complaints
ReviewSchema.index({ business_id: 1, is_public: 1, resolved: 1 });

// Analytics: weekly rating trend via aggregation
ReviewSchema.index({ business_id: 1, rating: 1, created_at: -1 });

module.exports = mongoose.model('Review', ReviewSchema);
