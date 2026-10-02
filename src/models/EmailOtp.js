'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * email_otps collection
 * One document per code sent. `code_hash` is sha256 (same pattern already
 * used for refresh tokens in auth.routes.js) -- a 6-digit code is low-value
 * enough that this is proportionate, unlike a password. Documents expire
 * from the database 2 hours after creation (TTL) -- that's just cleanup;
 * the code's real 10-minute validity window and the 3-attempt lock are
 * both checked in application logic, not by this TTL.
 */
const EmailOtpSchema = new Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  code_hash: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  locked_until: {
    type: Date,
    default: null,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  created_at: {
    type: Date,
    default: Date.now,
    expires: 7200, // Mongoose TTL shorthand -- auto-deleted 2 hours after creation
  },
});

module.exports = mongoose.model('EmailOtp', EmailOtpSchema);