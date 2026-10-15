'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
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
    phone: {
      type: String,
      trim: true,
      default: null,
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
    location_ids: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
      default: [],
    },
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

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ business_id: 1 });
UserSchema.index({ business_id: 1, role: 1 });
UserSchema.index({ business_id: 1, location_ids: 1 });

module.exports = mongoose.model('User', UserSchema);
