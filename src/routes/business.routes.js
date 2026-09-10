'use strict';
const express   = require('express');
const multer    = require('multer');
const router    = express.Router();
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const {
  listBusinesses, deleteBusiness, resetBusinessPassword,
  getResetRequests, getMyQrToken, getMySettings, updateMySettings, uploadMyLogo,
  updateGoogleUrl, toggleSuspend, getBusinessQr, listStaff, createStaff, deleteStaff,
} = require('../controllers/business.controller');
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 3 * 1024 * 1024 },
});
const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied. Super admin only.' });
  }
  next();
};
// Owner + staff can view; only the owner can change settings, logo, or team
router.get('/my-qr',          auth,                              asyncWrap(getMyQrToken));
router.get('/my-settings',    auth,                              asyncWrap(getMySettings));
router.patch('/my-settings',  auth, roleGuard('owner'),           asyncWrap(updateMySettings));
router.post('/my-logo',       auth, roleGuard('owner'), upload.single('logo'), asyncWrap(uploadMyLogo));

// Staff management -- owner only
router.get('/staff',          auth, roleGuard('owner'), asyncWrap(listStaff));
router.post('/staff',         auth, roleGuard('owner'), asyncWrap(createStaff));
router.delete('/staff/:id',   auth, roleGuard('owner'), asyncWrap(deleteStaff));

// Super-admin routes
router.get('/',                auth, requireSuperAdmin, asyncWrap(listBusinesses));
router.get('/reset-requests',  auth, requireSuperAdmin, asyncWrap(getResetRequests));
router.get('/:id/qr',          auth, requireSuperAdmin, asyncWrap(getBusinessQr));
router.patch('/:id/google-url', auth, requireSuperAdmin, asyncWrap(updateGoogleUrl));
router.patch('/:id/suspend',    auth, requireSuperAdmin, asyncWrap(toggleSuspend));
router.delete('/:id',           auth, requireSuperAdmin, asyncWrap(deleteBusiness));
router.post('/:id/reset-password', auth, requireSuperAdmin, asyncWrap(resetBusinessPassword));
module.exports = router;