'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const {
  getMyCode, getMyStats, getPublicSettings, validateCode,
} = require('../controllers/businessReferral.controller');

const router = express.Router();

// Public — used by the signup page, no auth.
router.get('/settings',        asyncWrap(getPublicSettings));
router.get('/validate/:code',  asyncWrap(validateCode));

// Owner-only — their own code + stats.
router.get('/my-code',  auth, roleGuard('owner'), asyncWrap(getMyCode));
router.get('/my-stats', auth, roleGuard('owner'), asyncWrap(getMyStats));

module.exports = router;
