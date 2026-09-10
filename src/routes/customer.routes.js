'use strict';

const nodePath  = require('path');
const multer    = require('multer');
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
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

router.get('/',  roleGuard('owner', 'staff'), validateQuery(listCustomersSchema), asyncWrap(listCustomers));

router.post('/', roleGuard('owner'), validate(createCustomerSchema),     asyncWrap(createCustomer));

router.post('/import',
  roleGuard('owner'),
  (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  }),
  asyncWrap(importCustomers)
);

router.get('/export',        roleGuard('owner', 'staff'), asyncWrap(exportCustomers));
router.get('/:id',           roleGuard('owner', 'staff'), asyncWrap(getCustomer));
router.get('/:id/requests',  roleGuard('owner', 'staff'), asyncWrap(getCustomerRequests));
router.get('/:id/reviews',   roleGuard('owner', 'staff'), asyncWrap(getCustomerReviews));
router.put('/:id',    roleGuard('owner'), validate(updateCustomerSchema), asyncWrap(updateCustomer));
router.delete('/:id', roleGuard('owner'), asyncWrap(deleteCustomer));

module.exports = router;