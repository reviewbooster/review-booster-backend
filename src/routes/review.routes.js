'use strict';

const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const { validateQuery } = require('../middleware/validate');
const { listReviewsSchema } = require('../validation/review.validation');
const { listReviews, listPrivateFeedback, resolveFeedback, exportReviews, generateReplyForReview, setFeedbackStage, setFeedbackNotes } = require('../controllers/review.controller');

router.use(auth);

router.get('/export',        roleGuard('owner', 'staff'), asyncWrap(exportReviews));
router.get('/private',       roleGuard('owner', 'staff'), validateQuery(listReviewsSchema), asyncWrap(listPrivateFeedback));
router.get('/',               roleGuard('owner', 'staff'), validateQuery(listReviewsSchema), asyncWrap(listReviews));

router.post('/:id/generate-reply', roleGuard('owner'),                                        asyncWrap(generateReplyForReview));
router.patch('/:id/resolve',       roleGuard('owner', 'staff'),                                 asyncWrap(resolveFeedback));
router.patch('/:id/stage',         roleGuard('owner', 'staff'),                                 asyncWrap(setFeedbackStage));
router.patch('/:id/notes',         roleGuard('owner', 'staff'),                                 asyncWrap(setFeedbackNotes));

module.exports = router;