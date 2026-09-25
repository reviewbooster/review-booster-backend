'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * businesses collection
 * Top-level tenant record.  Every other collection references _id as business_id.
 */
const BusinessSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'Business type is required'],
      enum: {
        values: ['salon', 'barbershop', 'gym', 'dental', 'clinic', 'restaurant', 'retail', 'auto', 'real_estate', 'education', 'pet_care', 'other'],
        message: '{VALUE} is not a supported business type',
      },
    },
    // Only used when type === 'other' Ã¢â‚¬â€ the owner's own typed-in category,
    // e.g. "Photography Studio". Shown in place of a generic label.
    type_other: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    google_review_url: {
      type: String,
      default: null,
      trim: true,
    },
    plan: {
      type: String,
      required: true,
      enum: ['trial', 'basic', 'pro', 'agency'],
      default: 'trial',
    },
    trial_ends_at: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    },
    // Set when an admin manually activates a paid plan (via UPI payment
    // confirmed outside the app). Null for businesses still on trial or
    // never activated. The daily cron suspends access once this passes,
    // same pattern as trial_ends_at.
    plan_expires_at: {
      type: Date,
      default: null,
    },
    // Engine B Ã¢â‚¬â€ set once, at signup, if this business came in through
    // another business's referral link. Points at the referring
    // Business's own _id (not a code) for easy lookups.
    referred_by_business_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    // True once this business's one-time Engine B signup discount has
    // been shown/used on an activate-plan Ã¢â‚¬â€ prevents it re-applying on
    // every future renewal.
    referral_discount_used: {
      type: Boolean,
      default: false,
    },
    // How this business joined the platform Ã¢â‚¬â€ set once at creation.
    // 'self_signup' = came through the public /signup form (may also
    // have referred_by_business_id set, if it came via an Engine B link).
    // 'admin_created' = a super_admin created the account directly.
    // null on businesses created before this field existed.
    source: {
      type: String,
      enum: ['self_signup', 'admin_created', null],
      default: null,
    },
    brand_color: {
      type: String,
      trim: true,
      default: null,       // e.g. '#F97316'
    },
    brand_logo_url: {
      type: String,
      trim: true,
      default: null,
    },
    whatsapp_consent_required: {
      type: Boolean,
      default: true,
    },
    is_suspended: {
      type: Boolean,
      default: false,
    },
    // Set true once this business finishes (or skips) the post-signup
    // onboarding wizard. Persisted server-side rather than in
    // localStorage so it stays correct even if they switch devices or
    // clear their browser -- this must show exactly once, ever.
    onboarding_completed: {
      type: Boolean,
      default: false,
    },
    // Product Adoption layer -- deliberately separate from
    // onboarding_completed above. Onboarding finishes business *setup*;
    // these track whether the owner has seen the post-setup product
    // introduction and walkthrough. Different lifecycle concept, different
    // fields, so one is never accidentally reused for the other.
    product_intro_seen: {
      type: Boolean,
      default: false,
    },
    product_tour_completed: {
      type: Boolean,
      default: false,
    },
    product_tour_started: {
      type: Boolean,
      default: false,
    },
    tour_skipped: {
      type: Boolean,
      default: false,
    },
    qr_token: {
      type:    String,
      unique:  true,
      sparse:  true,
      default: () => require('crypto').randomBytes(16).toString('hex'),
    },
    /**
     * Owner-editable wording for outgoing customer messages. Null means
     * "use the built-in default text" Ã¢â‚¬â€ lets every business start with a
     * sensible message without forcing them to configure anything.
     * Supports {{name}}, {{link}}, {{rating}} placeholders, substituted
     * at send time.
     */
    message_templates: {
      review_request:    { type: String, trim: true, default: null },
      thank_refer:       { type: String, trim: true, default: null },
      resolved_followup: { type: String, trim: true, default: null },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// No business_id here Ã¢â‚¬â€ this IS the root tenant. No compound index needed.
// We do want fast lookups by plan for admin dashboards.
BusinessSchema.index({ plan: 1 });
BusinessSchema.index({ is_suspended: 1 });

module.exports = mongoose.model('Business', BusinessSchema);