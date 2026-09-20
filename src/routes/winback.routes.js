'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const { getSettings, updateSettings, getDueCustomers, markSent } = require('../controllers/winback.controller');

const router = express.Router();

router.get('/settings',            auth, roleGuard('owner'), asyncWrap(getSettings));
router.patch('/settings',          auth, roleGuard('owner'), asyncWrap(updateSettings));
router.get('/due',                 auth, roleGuard('owner'), asyncWrap(getDueCustomers));
router.post('/mark-sent/:customerId', auth, roleGuard('owner'), asyncWrap(markSent));

module.exports = router;
