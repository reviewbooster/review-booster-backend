'use strict';
require('dns').setDefaultResultOrder('ipv4first');
const nodemailer = require('nodemailer');

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

module.exports = { sendPasswordResetEmail, sendApprovalEmail, sendRejectionEmail };