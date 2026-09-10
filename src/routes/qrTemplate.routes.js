'use strict';

const express = require('express');
const multer  = require('multer');
const auth    = require('../middleware/auth');
const ctrl    = require('../controllers/qrTemplate.controller');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
});

const roleGuard = require('../middleware/roleGuard');

router.use(auth);

router.get('/',       ctrl.getTemplates);
router.post('/',      roleGuard('owner'), upload.single('image'), ctrl.uploadTemplate);
router.patch('/:id',  roleGuard('owner'), ctrl.updateTemplate);
router.delete('/:id', roleGuard('owner'), ctrl.deleteTemplate);

module.exports = router;