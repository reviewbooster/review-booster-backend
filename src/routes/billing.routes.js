'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const asyncWrap = require('../utils/asyncWrap');
const { getPlans, getMyBillingStatus, getPaymentInfo } = require('../controllers/billing.controller');

const router = express.Router();

router.get('/plans',        auth, asyncWrap(getPlans));
router.get('/my-status',    auth, asyncWrap(getMyBillingStatus));
router.get('/payment-info', auth, asyncWrap(getPaymentInfo));

module.exports = router;