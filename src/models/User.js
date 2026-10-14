'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * users collection
 * One business can have multiple users (owner + optional branch managers).
 * super_admin users have no business_id restriction.
 *
 * Phase 1 (Owner Dashboard & Multi-Location spec): the old 'staff' role is
 * renamed to 'branch_manager', matching the spec's two-tier Owner / Branch
 * Manager model exactly. migrate-to-locations.js updates every existing
 * User document with role:'staff' to role:'branch_manager' and assigns
 * them to the business's new default Location. location_ids and
 * active_location_id are new fields.
 */
const UserSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      // null only for super_admin accounts
      default: null,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
    },
    password_hash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      required: true,
      enum: {
        values: ['owner', 'branch_manager', 'super_admin'],
        message: '{VALUE} is not a valid role',
      },
    },
    // Which locations a branch_manager can access. Not used for 'owner' or
    // 'super_admin' -- owners get implicit access to every location on
    // their own business_id, enforced in each controller/service, not via
    // this list (see spec section 8: "Branch managers must not gain
    // organization-wide access by default").
    location_ids: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
      default: [],
    },
    // The location this user is currently viewing in the normal (branch)
    // dashboard. For an owner, this is only ever set through the mandatory
    // branch-selector shown when switching out of the Owner Dashboard --
    // never silently defaulted or reused from a stale value (spec section
    // 3: "Never silently open the last-used branch or a default branch").
    // For a branch_manager, set automatically once they're assigned a
    // single location; if assigned more than one, they pick inside the
    // normal dashboard the same way an owner does.
    active_location_id: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
    },
    must_change_password: {
      type: Boolean,
      required: true,
      default: true,
    },
    /**
     * Hashed refresh token.
     * We store a SHA-256 hash, never the raw token, so a DB leak
     * doesn't immediately give attackers live refresh tokens.
     */
    refresh_token_hash: {
      type: String,
      default: null,
    },
    password_reset_requested: {
      type: Boolean,
      default: false,
    },
    reset_token_hash: {
      type: String,
      default: null,
    },
    reset_token_expires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Unique email across all tenants (login identifier)
UserSchema.index({ email: 1 }, { unique: true });

// Fast lookups for auth middleware and admin queries
UserSchema.index({ business_id: 1 });
UserSchema.index({ business_id: 1, role: 1 });

// Branch managers filtered by assigned location (Team & Permissions page, Phase 3)
UserSchema.index({ business_id: 1, location_ids: 1 });

module.exports = mongoose.model('User', UserSchema);
