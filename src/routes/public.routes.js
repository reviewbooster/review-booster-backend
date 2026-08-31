'use strict';

const express   = require('express');
const router    = express.Router();
const asyncWrap = require('../utils/asyncWrap');
const { validate } = require('../middleware/validate');
const { submitReviewSchema } = require('../validation/review.validation');
const { getQrReview, validateToken, submitReview } = require('../controllers/public.controller');

// NO auth middleware — hit by customers

// IMPORTANT: /qr/:qr_token must be registered before /:token
// otherwise Express matches 'qr' as the token value
router.get('/qr/:qr_token', asyncWrap(getQrReview));

router.get('/:token',         asyncWrap(validateToken));
router.post('/:token/submit', validate(submitReviewSchema), asyncWrap(submitReview));

module.exports = router;