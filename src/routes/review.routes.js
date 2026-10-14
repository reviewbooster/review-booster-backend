'use strict';

const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const { validateQuery } = require('../middleware/validate');
const { listReviewsSchema } = require('../validation/review.validation');
const { listReviews, listPrivateFeedback, listFeedbackTags, getThemeSummary, getCustomerContext, resolveFeedback, exportReviews, exportPrivateFeedback, generateReplyForReview, setFeedbackStage, markFeedbackSent, setFeedbackNotes } = require('../controllers/review.controller');

router.use(auth);

router.get('/export',        roleGuard('owner', 'branch_manager'), asyncWrap(exportReviews));
router.get('/tags',          roleGuard('owner', 'branch_manager'), asyncWrap(listFeedbackTags));
router.get('/theme-summary', roleGuard('owner', 'branch_manager'), asyncWrap(getThemeSummary));
router.get('/private',       roleGuard('owner', 'branch_manager'), validateQuery(listReviewsSchema), asyncWrap(listPrivateFeedback));
router.get('/private/export', roleGuard('owner', 'branch_manager'), asyncWrap(exportPrivateFeedback));
router.get('/',               roleGuard('owner', 'branch_manager'), validateQuery(listReviewsSchema), asyncWrap(listReviews));

router.get('/:id/customer-context', roleGuard('owner', 'branch_manager'),                             asyncWrap(getCustomerContext));
router.post('/:id/generate-reply', roleGuard('owner'),                                        asyncWrap(generateReplyForReview));
router.patch('/:id/resolve',       roleGuard('owner', 'branch_manager'),                                 asyncWrap(resolveFeedback));
router.patch('/:id/stage',         roleGuard('owner', 'branch_manager'),                                 asyncWrap(setFeedbackStage));
router.patch('/:id/mark-sent',     roleGuard('owner', 'branch_manager'),                                 asyncWrap(markFeedbackSent));
router.patch('/:id/notes',         roleGuard('owner', 'branch_manager'),                                 asyncWrap(setFeedbackNotes));

module.exports = router;
