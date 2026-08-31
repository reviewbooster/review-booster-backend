'use strict';

const nodePath  = require('path');
const multer    = require('multer');
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const asyncWrap = require('../utils/asyncWrap');
const { validate, validateQuery } = require('../middleware/validate');
const { createCustomerSchema, updateCustomerSchema, listCustomersSchema } = require('../validation/customer.validation');
const {
  listCustomers,
  createCustomer,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  importCustomers,
  getCustomerRequests,
  getCustomerReviews,
  exportCustomers,
} = require('../controllers/customer.controller');

// ── Multer: memory storage, 500 KB cap, CSV/XLSX only ─────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 512 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = nodePath.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.xlsx') { cb(null, true); }
    else { cb(new Error('Only .csv and .xlsx files are supported.')); }
  },
});

router.use(auth);

router.get('/',  validateQuery(listCustomersSchema), asyncWrap(listCustomers));
router.post('/', validate(createCustomerSchema),     asyncWrap(createCustomer));

// Import — MUST be before /:id routes
router.post('/import',
  (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  }),
  asyncWrap(importCustomers)
);

router.get('/export',        asyncWrap(exportCustomers));
router.get('/:id',          asyncWrap(getCustomer));
router.get('/:id/requests',  asyncWrap(getCustomerRequests));
router.get('/:id/reviews',   asyncWrap(getCustomerReviews));
router.put('/:id',    validate(updateCustomerSchema), asyncWrap(updateCustomer));
router.delete('/:id', asyncWrap(deleteCustomer));

module.exports = router;