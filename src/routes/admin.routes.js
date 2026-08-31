'use strict';
const express   = require('express');
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const admin     = require('../controllers/admin.controller');

const router = express.Router();

router.use(auth);
router.use(roleGuard('super_admin'));

router.get('/pending-count',          admin.getPendingCount);
router.get('/businesses',             admin.getBusinesses);
router.put('/businesses/:id/approve', admin.approveBusiness);
router.put('/businesses/:id/reject',  admin.rejectBusiness);

module.exports = router;