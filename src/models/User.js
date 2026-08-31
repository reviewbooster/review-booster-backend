'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * users collection
 * One business can have multiple users (owner + optional staff).
 * super_admin users have no business_id restriction.
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
        values: ['owner', 'staff', 'super_admin'],
        message: '{VALUE} is not a valid role',
      },
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

module.exports = mongoose.model('User', UserSchema);
