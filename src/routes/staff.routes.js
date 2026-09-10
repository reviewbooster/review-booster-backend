'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const asyncWrap = require('../utils/asyncWrap');
const {
  listStaffMembers, createStaffMember, deleteStaffMember, getStaffStats,
} = require('../controllers/staff.controller');

const router = express.Router();

// Owner + staff can view the directory (needed for "who did this" pickers).
router.get('/',        auth,                      asyncWrap(listStaffMembers));

// Managing the directory and viewing stats — owner only.
router.post('/',       auth, roleGuard('owner'),   asyncWrap(createStaffMember));
router.delete('/:id',  auth, roleGuard('owner'),   asyncWrap(deleteStaffMember));
router.get('/stats',   auth, roleGuard('owner'),   asyncWrap(getStaffStats));

module.exports = router;
