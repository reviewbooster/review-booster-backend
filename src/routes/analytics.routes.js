'use strict';
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const asyncWrap = require('../utils/asyncWrap');
const { getSummary, getReviewsOverTime, getQrStats, getByLocation, exportAnalyticsReport } = require('../controllers/analytics.controller');

router.use(auth);
router.get('/summary',           asyncWrap(getSummary));
router.get('/reviews-over-time', asyncWrap(getReviewsOverTime));
router.get('/qr-stats',          asyncWrap(getQrStats));
// Phase 4 (Owner Dashboard spec, section 4): per-branch comparison table
// for the Owner Overview page. Owner/super_admin only (enforced inside
// getByLocation itself).
router.get('/by-location',       asyncWrap(getByLocation));
router.get('/export',            asyncWrap(exportAnalyticsReport));

module.exports = router;
