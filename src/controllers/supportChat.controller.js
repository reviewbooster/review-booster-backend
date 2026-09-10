'use strict';
/**
 * controllers/supportChat.controller.js
 * Guest-side functions (no auth — pre-login Help & Support widget) and
 * admin-side functions (super_admin only, mounted under /api/admin).
 */
const crypto = require('crypto');
const SupportChat = require('../models/SupportChat');
const { sendSupportReplyEmail } = require('../utils/mailer');

// ── Guest side (public, no auth) ────────────────────────────────────────────

// POST /api/support-chat/start
const startChat = async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !name.trim())    return res.status(400).json({ error: 'Name is required.' });
  if (!email || !email.trim())  return res.status(400).json({ error: 'Email is required.' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required.' });

  const token = crypto.randomBytes(20).toString('hex');
  const chat = await SupportChat.create({
    token,
    guest_name: name.trim(),
    guest_email: email.trim().toLowerCase(),
    messages: [{ sender: 'guest', text: message.trim() }],
    unread_by_admin: true,
  });

  res.status(201).json({ data: { token: chat.token, messages: chat.messages } });
};

// GET /api/support-chat/:token
const getChat = async (req, res) => {
  const chat = await SupportChat.findOne({ token: req.params.token });
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });

  if (chat.unread_by_guest) {
    chat.unread_by_guest = false;
    await chat.save();
  }

  res.json({ data: { messages: chat.messages, status: chat.status, guest_name: chat.guest_name } });
};

// POST /api/support-chat/:token/messages
const sendGuestMessage = async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required.' });

  const chat = await SupportChat.findOne({ token: req.params.token });
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });

  chat.messages.push({ sender: 'guest', text: message.trim() });
  chat.status = 'open';
  chat.unread_by_admin = true;
  chat.last_message_at = new Date();
  await chat.save();

  res.json({ data: { messages: chat.messages } });
};

// ── Admin side (super_admin only) ───────────────────────────────────────────

// GET /api/admin/support-chats
const listChatsAdmin = async (req, res) => {
  const chats = await SupportChat.find({})
    .sort({ last_message_at: -1 })
    .select('token guest_name guest_email status unread_by_admin last_message_at messages')
    .lean();

  const data = chats.map(function(c) {
    const last = c.messages[c.messages.length - 1];
    return {
      _id: c._id,
      guest_name: c.guest_name,
      guest_email: c.guest_email,
      status: c.status,
      unread_by_admin: c.unread_by_admin,
      last_message_at: c.last_message_at,
      last_message_preview: last ? last.text.slice(0, 80) : '',
    };
  });

  res.json({ data });
};

// GET /api/admin/support-chats/:id
const getChatAdmin = async (req, res) => {
  const chat = await SupportChat.findById(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });

  if (chat.unread_by_admin) {
    chat.unread_by_admin = false;
    await chat.save();
  }

  res.json({ data: chat });
};

// POST /api/admin/support-chats/:id/messages
const replyChatAdmin = async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required.' });

  const chat = await SupportChat.findById(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });

  chat.messages.push({ sender: 'admin', text: message.trim() });
  chat.unread_by_guest = true;
  chat.last_message_at = new Date();
  await chat.save();

  // Best-effort email notification — don't fail the reply if email sending has an issue
  try {
    await sendSupportReplyEmail(chat.guest_email, chat.guest_name, message.trim());
  } catch (e) {
    // swallow — the reply itself succeeded and is visible in-widget
  }

  res.json({ data: chat });
};

// PATCH /api/admin/support-chats/:id  — body: { status: 'open' | 'closed' }
const setChatStatusAdmin = async (req, res) => {
  const { status } = req.body || {};
  if (!['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: '"status" must be "open" or "closed".' });
  }
  const chat = await SupportChat.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ data: chat });
};

module.exports = {
  startChat, getChat, sendGuestMessage,
  listChatsAdmin, getChatAdmin, replyChatAdmin, setChatStatusAdmin,
};