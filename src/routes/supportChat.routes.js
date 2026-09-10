'use strict';
const express   = require('express');
const router    = express.Router();
const asyncWrap = require('../utils/asyncWrap');
const { startChat, getChat, sendGuestMessage } = require('../controllers/supportChat.controller');

// No auth — this is the pre-login Help & Support widget.
router.post('/start',            asyncWrap(startChat));
router.get('/:token',            asyncWrap(getChat));
router.post('/:token/messages',  asyncWrap(sendGuestMessage));

module.exports = router;