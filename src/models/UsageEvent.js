'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * usage_events collection
 * One row per metered action (an AI reply generated, a follow-up
 * scheduled, a win-back contact made) -- append-only, never updated or
 * decremented. "Usage this month" is always a live count of rows created
 * since the start of the current calendar month, so there's no counter to
 * reset, drift, or get out of sync with what actually happened. Review
 * requests and SMS don't need this collection -- they're already counted
 * directly from the existing ReviewRequest collection (see
 * utils/usageMeter.js).
 */
const UsageEventSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
    },
    type: {
      type: String,
      required: true,
      enum: ['ai_reply', 'follow_up', 'win_back_contact'],
    },
    // Optional pointer to what this usage event was about (a Review, a
    // Customer, etc.) -- purely for later debugging/audit, never read by
    // the counting logic itself.
    ref_id: {
      type: Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

// The one query this collection exists to serve: "how many <type> events
// has this business logged since <date>?"
UsageEventSchema.index({ business_id: 1, type: 1, created_at: 1 });

module.exports = mongoose.model('UsageEvent', UsageEventSchema);