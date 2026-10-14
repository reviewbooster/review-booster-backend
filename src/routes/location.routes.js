'use strict';
/**
 * src/routes/location.routes.js
 * Phase 2: read/switch endpoints backing the owner shell's branch
 * selector (any authenticated user). Phase 3: create/edit a location,
 * owner only (spec section 8 capability table -- "Add/remove locations:
 * Owner yes, Branch manager no by default").
 *
 * NOTE: router.patch('/:id', ...) must come after router.patch('/active',
 * ...) -- Express matches routes in order, and '/active' would otherwise
 * be captured by the '/:id' pattern as if "active" were a location id.
 */
const express = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { asyncWrap } = require('../middleware/errorHandler');
const {
  listMyLocations, setActiveLocation, createLocation, updateLocation,
} = require('../controllers/location.controller');

const router = express.Router();

router.get('/', auth, asyncWrap(listMyLocations));
router.post('/', auth, roleGuard('owner'), asyncWrap(createLocation));
router.patch('/active', auth, asyncWrap(setActiveLocation));
router.patch('/:id', auth, roleGuard('owner'), asyncWrap(updateLocation));

module.exports = router;
