'use strict';
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const asyncWrap = require('../utils/asyncWrap');
const { getSummary, getReviewsOverTime, getQrStats } = require('../controllers/analytics.controller');

router.use(auth);
router.get('/summary',           asyncWrap(getSummary));
router.get('/reviews-over-time', asyncWrap(getReviewsOverTime));
router.get('/qr-stats',          asyncWrap(getQrStats));

module.exports = router;