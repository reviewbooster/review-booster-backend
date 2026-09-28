'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * success_stories collection
 * One story per business: the owner's short answers, a frozen copy of the
 * results as they stood when they submitted, and an explicit, versioned
 * consent record (who agreed, when, to what, under which wording). Nothing
 * here is published anywhere until a super admin approves it.
 */
const STATUSES = [
  'potential', 'invited',            // set by a super admin, before the owner acts
  'submitted', 'under_review',
  'changes_needed', 'approved', 'rejected',
  'withdrawn',                       // the owner took their permission back
];

const ConsentSchema = new Schema(
  {
    version:  { type: String, required: true },
    given_at: { type: Date, required: true },
    given_by: {
      user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      name:    { type: String, default: null },
      email:   { type: String, default: null },
    },
    permissions: {
      testimonial:   { type: Boolean, default: false },
      business_name: { type: Boolean, default: false },
      results:       { type: Boolean, default: false },
      logo:          { type: Boolean, default: false },
    },
    // The exact declaration wording the owner agreed to at that moment.
    declaration: { type: String, default: null },
  },
  { _id: false }
);

const DecisionSchema = new Schema(
  {
    action: { type: String, required: true },
    from:   { type: String },
    to:     { type: String },
    note:   { type: String, default: null },
    by: {
      user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      name:    { type: String, default: null },
      email:   { type: String, default: null },
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SuccessStorySchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      unique: true,
    },
    status: { type: String, enum: STATUSES, default: 'submitted' },

    what_changed:    { type: String, default: '' },
    happiest_result: { type: String, default: '' },
    testimonial:     { type: String, default: '' },

    // Google baseline/latest (owner-entered) + activity counted from real
    // records, frozen at submit time so what the admin reviews is exactly
    // what the owner saw and agreed to share.
    results_snapshot: { type: Schema.Types.Mixed, default: null },

    consent:     { type: ConsentSchema, default: null },   // the current consent
    consent_log: { type: [ConsentSchema], default: [] },   // every grant and withdrawal

    submitted_at: { type: Date, default: null },
    withdrawn_at: { type: Date, default: null },

    // Shown to the owner when a super admin asks for changes.
    admin_note: { type: String, default: null },

    // How a super admin has polished the story for marketing use. The owner's
    // own words are never overwritten -- this is kept separately.
    presentation: {
      headline: { type: String, default: '' },
      quote:    { type: String, default: '' },
    },

    // Every decision, in order: who moved the story, when, and why.
    decision_log: { type: [DecisionSchema], default: [] },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('SuccessStory', SuccessStorySchema);
module.exports.STATUSES = STATUSES;