'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const {
  getMySettings, updateMySettings, getReferralLanding, lookupReferralCode,
  redeemReferral, listRewardsEarned, markRewardGiven, getCustomerReferral,
  getReferralStats, listReferrers,
} = require('../controllers/referral.controller');

const router = express.Router();

// Dashboard / staff tools — specific routes first, before the /:code param route.
router.get('/settings',   auth,                   asyncWrap(getMySettings));
router.patch('/settings', auth, roleGuard('owner'), asyncWrap(updateMySettings));

router.get('/rewards',                    auth,                   asyncWrap(listRewardsEarned));
router.post('/rewards/:customer_id/claim', auth, roleGuard('owner'), asyncWrap(markRewardGiven));

router.get('/lookup/:code', auth, asyncWrap(lookupReferralCode));
router.post('/redeem',      auth, asyncWrap(redeemReferral));

router.get('/customer/:customer_id', auth, asyncWrap(getCustomerReferral));
router.get('/stats',                 auth, asyncWrap(getReferralStats));
router.get('/referrers',             auth, asyncWrap(listReferrers));

// Public — no auth, hit by anyone opening a shared referral link
router.get('/:code', asyncWrap(getReferralLanding));

module.exports = router;
