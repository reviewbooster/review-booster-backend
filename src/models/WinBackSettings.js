'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * win_back_settings collection
 * Per-business, one document. Powers a single generic "customer hasn't
 * been back in a while" reminder — works the same way for every business
 * type (a salon rebooking nudge, a gym win-back, a car-service reminder),
 * just with the owner's own threshold and message text. Sending is still
 * manual — same pre-filled WhatsApp-link pattern as every other message
 * in the app, nothing goes out on its own.
 */
const WinBackSettingsSchema = new Schema(
  {
    business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'business_id is required'],
      unique: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    inactive_days: {
      type: Number,
      default: 30,
      min: 1,
    },
    message_text: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "Hi {name}, it's been a while since we've seen you! We'd love to have you back.",
    },
    // Optional incentive shown as its own toggle so the owner can turn it
    // on/off without retyping the message above -- appended when building
    // the WhatsApp link, not stored merged into message_text.
    offer_enabled: {
      type: Boolean,
      default: false,
    },
    offer_text: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    // Appends the business's own Google review link to the message when
    // on. The link itself isn't stored here -- read from the business's
    // own settings (google_review_url) at send time.
    link_enabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('WinBackSettings', WinBackSettingsSchema);
