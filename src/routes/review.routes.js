'use strict';

const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const asyncWrap = require('../utils/asyncWrap');
const { validateQuery } = require('../middleware/validate');
const { listReviewsSchema } = require('../validation/review.validation');
const { listReviews, listPrivateFeedback, resolveFeedback, exportReviews } = require('../controllers/review.controller');

router.use(auth);

// IMPORTANT: /private must be before /:id — otherwise Express treats
// the string "private" as an :id param and calls the wrong handler
router.get('/export',        asyncWrap(exportReviews));
router.get('/private',       validateQuery(listReviewsSchema), asyncWrap(listPrivateFeedback));
router.get('/',              validateQuery(listReviewsSchema), asyncWrap(listReviews));
router.patch('/:id/resolve',                                   asyncWrap(resolveFeedback));

module.exports = router;