'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const billing   = require('../controllers/billing.controller');
const businessReferral = require('../controllers/businessReferral.controller');
const auditLog = require('../controllers/auditLog.controller');
const supportChat = require('../controllers/supportChat.controller');
const asyncWrap = require('../utils/asyncWrap');

const router = express.Router();

router.use(auth);
router.use(roleGuard('super_admin'));

// Manual UPI billing â€” plan pricing, payment info, and activating a
// business's paid plan once you've confirmed their UPI payment yourself.
router.get('/plans',                          asyncWrap(billing.listPlansAdmin));
router.patch('/plans/:slug',                  asyncWrap(billing.updatePlan));
router.get('/platform-settings',              asyncWrap(billing.getPlatformSettingsAdmin));
router.patch('/platform-settings',            asyncWrap(billing.updatePlatformSettings));
router.post('/businesses/:id/activate-plan',  asyncWrap(billing.activateBusinessPlan));

router.get('/business-referral-settings',             asyncWrap(businessReferral.getSettingsAdmin));
router.patch('/business-referral-settings',            asyncWrap(businessReferral.updateSettingsAdmin));
router.get('/business-referrals',                      asyncWrap(businessReferral.listSignupsAdmin));
router.post('/business-referrals/:id/mark-credited',   asyncWrap(businessReferral.markCreditedAdmin));

// Audit log + business detail rollup
router.get('/audit-log',                    asyncWrap(auditLog.getAuditLog));
router.get('/businesses/:id/detail',        asyncWrap(auditLog.getBusinessDetail));
router.get('/dashboard-stats',              asyncWrap(auditLog.getDashboardStats));
router.get('/needs-attention',              asyncWrap(auditLog.getNeedsAttention));

// Support Chats â€” pre-login Help & Support widget, admin side
router.get('/support-chats',                   asyncWrap(supportChat.listChatsAdmin));
router.get('/support-chats/:id',                asyncWrap(supportChat.getChatAdmin));
router.post('/support-chats/:id/messages',      asyncWrap(supportChat.replyChatAdmin));
router.patch('/support-chats/:id',              asyncWrap(supportChat.setChatStatusAdmin));

module.exports = router;