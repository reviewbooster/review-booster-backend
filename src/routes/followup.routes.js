'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const { listFollowUps } = require('../controllers/followup.controller');

const router = express.Router();

router.get('/', auth, roleGuard('owner', 'staff'), asyncWrap(listFollowUps));

module.exports = router;
