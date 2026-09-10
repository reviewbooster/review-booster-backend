'use strict';
require('dns').setDefaultResultOrder('ipv4first');
const nodemailer = require('nodemailer');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createTransporter() {
  return nodemailer.createTransport({
    host:              'smtp.gmail.com',
    port:              587,
    secure:            false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    family:            4,
    connectionTimeout: 8000,
    greetingTimeout:   8000,
    socketTimeout:     10000,
  });
}

const sendPasswordResetEmail = async (toEmail, resetLink) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from:    '"ReviewBooster" <' + process.env.SMTP_USER + '>',
    to:      toEmail,
    subject: 'ReviewBooster \u2014 Password Reset Link',
    html:
      '<div style="font-family:sans-serif;max-width:480px;margin:auto">' +
      '<h2 style="color:#7c3aed">Password Reset</h2>' +
      '<p>You requested a password reset for your ReviewBooster super admin account.</p>' +
      '<p><a href="' + resetLink + '" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Reset Password</a></p>' +
      '<p style="color:#666;font-size:13px">This link expires in 1 hour.</p>' +
      '<p style="color:#666;font-size:13px">If you did not request this, ignore this email.</p>' +
      '</div>',
  });
};

const sendApprovalEmail = async (toEmail, ownerName, businessName) => {
  const transporter = createTransporter();
  const loginUrl = (process.env.FRONTEND_URL || '') + '/login';
  const btnStyle = 'display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold';
  await transporter.sendMail({
    from:    '"ReviewBooster" <' + process.env.SMTP_USER + '>',
    to:      toEmail,
    subject: 'ReviewBooster \u2014 Your account is approved!',
    html:
      '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">' +
      '<h2 style="color:#7c3aed">You\'re in, ' + ownerName + '!</h2>' +
      '<p>Your ReviewBooster account for <strong>' + businessName + '</strong> has been approved. You can now log in and start collecting reviews.</p>' +
      '<p style="margin:24px 0"><a href="' + loginUrl + '" style="' + btnStyle + '">Log in to Dashboard</a></p>' +
      '<p style="color:#888;font-size:13px">Powered by Adcend</p>' +
      '</div>',
  });
};

const sendRejectionEmail = async (toEmail, ownerName, businessName) => {
  const transporter = createTransporter();
  const waLink = process.env.ADMIN_WHATSAPP_URL || '';
  await transporter.sendMail({
    from:    '"ReviewBooster" <' + process.env.SMTP_USER + '>',
    to:      toEmail,
    subject: 'ReviewBooster \u2014 Account Application Update',
    html:
      '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">' +
      '<h2 style="color:#7c3aed">Account Application Update</h2>' +
      '<p>Hi ' + ownerName + ', unfortunately your ReviewBooster account for <strong>' + businessName + '</strong> could not be approved at this time.</p>' +
      '<p>If you think this is an error or would like to discuss, please reach out:</p>' +
      '<ul style="line-height:2.2">' +
      '<li>Email: <a href="mailto:adcendco@gmail.com">adcendco@gmail.com</a></li>' +
      (waLink ? '<li>WhatsApp: <a href="' + waLink + '">Chat with us on WhatsApp</a></li>' : '') +
      '</ul>' +
      '<p style="color:#888;font-size:13px">Powered by Adcend</p>' +
      '</div>',
  });
};

const sendFeedbackAlertEmail = async (toEmail, ownerName, businessName, rating, feedbackText) => {
  const transporter = createTransporter();
  const dashboardUrl = (process.env.FRONTEND_URL || '') + '/dashboard/feedback';
  const stars = '\u2605'.repeat(rating) + '\u2606'.repeat(5 - rating);
  const cleanFeedback = feedbackText ? feedbackText.trim() : '';

  const textBody =
    'Hi ' + ownerName + ',\n\n' +
    'You received a new ' + rating + '-star review for ' + businessName + ' that needs your attention.\n\n' +
    (cleanFeedback ? 'Customer feedback: "' + cleanFeedback + '"\n\n' : '') +
    'View and reply here: ' + dashboardUrl + '\n\n' +
    'This is a notification from your ReviewBooster dashboard.';

  await transporter.sendMail({
    from:    '"ReviewBooster" <' + process.env.SMTP_USER + '>',
    to:      toEmail,
    subject: 'New ' + rating + '-star review for ' + businessName,
    text:    textBody,
    html:
      '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">' +
      '<h2 style="color:#dc2626">New review needs your attention</h2>' +
      '<p>Hi ' + ownerName + ', you received a new ' + rating + '-star review for ' + businessName + '.</p>' +
      '<p style="font-size:20px;color:#f59e0b;letter-spacing:2px">' + stars + '</p>' +
      (cleanFeedback ? '<p style="background:#f9fafb;border-radius:8px;padding:12px;color:#374151">"' + escapeHtml(cleanFeedback) + '"</p>' : '') +
      '<p style="margin:24px 0"><a href="' + dashboardUrl + '" style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">View & Reply</a></p>' +
      '<p style="color:#888;font-size:13px">This is a notification from your ReviewBooster dashboard.</p>' +
      '</div>',
  });
};

const sendSupportReplyEmail = async (toEmail, guestName, replyText) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from:    '"ReviewBooster Support" <' + process.env.SMTP_USER + '>',
    to:      toEmail,
    subject: 'New reply to your ReviewBooster support chat',
    html:
      '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">' +
      '<h2 style="color:#7c3aed">You have a new reply</h2>' +
      '<p>Hi ' + guestName + ', our team replied to your support chat:</p>' +
      '<p style="background:#f9fafb;border-radius:8px;padding:12px;color:#374151">' + escapeHtml(replyText) + '</p>' +
      '<p style="color:#666;font-size:13px">Reopen the Help & Support chat on the ReviewBooster login page to continue the conversation.</p>' +
      '<p style="color:#888;font-size:13px">Powered by Adcend</p>' +
      '</div>',
  });
};

module.exports = { sendPasswordResetEmail, sendApprovalEmail, sendRejectionEmail, sendFeedbackAlertEmail, sendSupportReplyEmail };