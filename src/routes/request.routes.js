'use strict';

const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const asyncWrap = require('../utils/asyncWrap');
const { validate, validateQuery } = require('../middleware/validate');
const { sendRequestSchema, listRequestsSchema } = require('../validation/request.validation');
const { sendRequest, listRequests } = require('../controllers/request.controller');

router.use(auth);

router.post('/', validate(sendRequestSchema),       asyncWrap(sendRequest));
router.get('/',  validateQuery(listRequestsSchema), asyncWrap(listRequests));

module.exports = router;