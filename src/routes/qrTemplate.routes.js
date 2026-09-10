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

router.use(auth);

router.get('/',       ctrl.getTemplates);
router.post('/',      upload.single('image'), ctrl.uploadTemplate);
router.patch('/:id',  ctrl.updateTemplate);
router.delete('/:id', ctrl.deleteTemplate);

module.exports = router;