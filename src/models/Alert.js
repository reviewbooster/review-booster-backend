'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * alerts collection
 * Created automatically when:
 *   - A private (1-3 star) review is submitted  → type: 'negative_review'
 *   - A billing event requires attention         → type: 'billing'
 *   - A system-level event occurs                → type: 'system'
 *
 * Displayed as a red badge on the Feedback tab in the dashboard.
 * Owner dismisses by clicking the alert → sets seen: true.
 */
const AlertSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    /**
     * Optional — linked review when type === 'negative_review'.
     * Null for billing / system alerts.
     */
    review_id: {
      type: Schema.Types.ObjectId,
      ref: 'Review',
      default: null,
    },
    type: {
      type: String,
      required: true,
      enum: {
        values: ['negative_review', 'billing', 'system'],
        message: '{VALUE} is not a valid alert type',
      },
    },
    message: {
      type: String,
      required: [true, 'Alert message is required'],
      trim: true,
    },
    seen: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Primary tenant filter — used on every dashboard load
AlertSchema.index({ business_id: 1, seen: 1 });

// Unseen count query (badge on sidebar)
AlertSchema.index({ business_id: 1, seen: 1, created_at: -1 });

module.exports = mongoose.model('Alert', AlertSchema);
