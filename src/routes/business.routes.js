'use strict';
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const asyncWrap = require('../utils/asyncWrap');
const {
  listBusinesses, deleteBusiness, resetBusinessPassword,
  getResetRequests, getMyQrToken, getMySettings, updateMySettings,
  updateGoogleUrl, toggleSuspend, getBusinessQr,
} = require('../controllers/business.controller');

const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied. Super admin only.' });
  }
  next();
};

// Owner-accessible - no super_admin check
router.get('/my-qr',          auth,                              asyncWrap(getMyQrToken));
router.get('/my-settings',    auth,                              asyncWrap(getMySettings));
router.patch('/my-settings',  auth,                              asyncWrap(updateMySettings));

// Super-admin routes
router.get('/',                auth, requireSuperAdmin, asyncWrap(listBusinesses));
router.get('/reset-requests',  auth, requireSuperAdmin, asyncWrap(getResetRequests));
router.get('/:id/qr',          auth, requireSuperAdmin, asyncWrap(getBusinessQr));
router.patch('/:id/google-url', auth, requireSuperAdmin, asyncWrap(updateGoogleUrl));
router.patch('/:id/suspend',    auth, requireSuperAdmin, asyncWrap(toggleSuspend));
router.delete('/:id',           auth, requireSuperAdmin, asyncWrap(deleteBusiness));
router.post('/:id/reset-password', auth, requireSuperAdmin, asyncWrap(resetBusinessPassword));

module.exports = router;