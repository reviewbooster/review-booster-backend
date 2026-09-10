'use strict';
/**
 * models/SupportChat.js
 * Pre-login "Help & Support" chat. Visitors on the login page aren't
 * authenticated, so a thread is identified by a random public `token`
 * stored in the visitor's browser (localStorage) rather than a user
 * account. Super admins reply from the admin Support Chats page.
 */
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender:     { type: String, enum: ['guest', 'admin'], required: true },
  text:       { type: String, required: true, trim: true },
  created_at: { type: Date, default: Date.now },
}, { _id: false });

const supportChatSchema = new mongoose.Schema({
  token:            { type: String, required: true, unique: true, index: true },
  guest_name:       { type: String, required: true, trim: true },
  guest_email:      { type: String, required: true, trim: true, lowercase: true },
  messages:         { type: [messageSchema], default: [] },
  status:           { type: String, enum: ['open', 'closed'], default: 'open' },
  last_message_at:  { type: Date, default: Date.now },
  unread_by_admin:  { type: Boolean, default: true },
  unread_by_guest:  { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('SupportChat', supportChatSchema);