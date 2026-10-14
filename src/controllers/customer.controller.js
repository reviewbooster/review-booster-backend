const { buildBrandedCsv, sendBrandedPdf } = require('../utils/exportBranding');
'use strict';
/**
 * customer.controller.js
 * Full CRUD for customers + bulk CSV/XLSX import (Session 16).
 *
 * Branch scoping (Owner Dashboard & Multi-Location spec, agreed with
 * Vivek: Option A -- one customer identity, tagged by branch, not
 * duplicated per branch): every list/read endpoint is scoped through the
 * shared utils/locationScope.js helper, the same server-side enforcement
 * already used by analytics/reviews/referrals -- a branch_manager only
 * ever sees customers tagged to their own assigned location(s); an owner
 * sees the whole business by default, with an optional ?location_id=
 * filter. location_id is set ONCE, at creation time, and never
 * reassigned on a later visit to a different branch.
 */
const mongoose         = require('mongoose');
const nodePath        = require('path');
const { PassThrough } = require('stream');
const Customer        = require('../models/Customer');
const ReviewRequest   = require('../models/ReviewRequest');
const Review          = require('../models/Review');
const Business        = require('../models/Business');
const FollowUp        = require('../models/FollowUp');
const Location         = require('../models/Location');
const User             = require('../models/User');
const { getPlanLimits, getEffectivePlanSlug } = require('../utils/planLimits');
const { lockedResponse } = require('../utils/planGate');
const { getLocationScopeFilter } = require('../utils/locationScope');

const tenantFilter = (user) => {
  if (user.role === 'super_admin') return {};
  return { business_id: user.business_id };
};

// Resolves which location a newly-created/imported customer should be
// tagged with. Mirrors referral.controller.js's resolveRedemptionLocationId,
// but non-blocking: unlike a referral redemption (which must be attributed
// to record branch-specific counts correctly), adding a customer manually
// without picking a location just leaves them as "unknown branch" rather
// than failing the request -- most businesses are still single-location
// and shouldn't have to think about this.
//   owner / super_admin -- uses location_id from the request if it's a
//     real location belonging to this business, else null.
//   branch_manager -- always their own assigned location (ignores any
//     client-supplied location_id that isn't actually theirs), or null if
//     they have no location assigned yet.
async function resolveActingLocationId(req, business_id) {
  const requestedId = req.body.location_id || req.query.location_id;

  if (req.user.role === 'owner' || req.user.role === 'super_admin') {
    if (!requestedId || !mongoose.Types.ObjectId.isValid(requestedId)) return null;
    const loc = await Location.findOne({ _id: requestedId, business_id }).select('_id').lean();
    return loc ? loc._id : null;
  }

  const me = await User.findById(req.user.id).select('location_ids').lean();
  const myIds = ((me && me.location_ids) || []).map((id) => String(id));
  if (myIds.length === 0) return null;
  if (requestedId && myIds.includes(String(requestedId))) return requestedId;
  return myIds[0];
}

// Escapes regex special characters in user-supplied search text before
// it is used in a MongoDB $regex query, preventing malformed/expensive patterns.
function escapeRegex(s) {
  return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SORT_OPTIONS = {
  newest:    { added_at: -1 },
  oldest:    { added_at: 1 },
  name_asc:  { name: 1 },
  name_desc: { name: -1 },
};

// GET /api/customers
const listCustomers = async (req, res) => {
  const { search, page, limit, sort, tag } = req.validatedQuery;
  const status = req.query.status;
  const dueFollowUp = req.query.due_followup === 'true';
  const filter = tenantFilter(req.user);

  let locationFilter;
  try {
    locationFilter = await getLocationScopeFilter(req);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  Object.assign(filter, locationFilter);

  if (status === 'active')   filter.opted_out = false;
  if (status === 'inactive') filter.opted_out = true;
  if (tag) filter.tags = tag;
  if (dueFollowUp && req.user.business_id) {
    const dueIds = await FollowUp.find({
      business_id: req.user.business_id,
      status: 'open',
      due_date: { $lte: new Date() },
    }).distinct('customer_id');
    filter._id = { $in: dueIds };
  }
  if (search) {
    var safeSearch = escapeRegex(search);
    filter.$or = [
      { name:  { $regex: safeSearch, $options: 'i' } },
      { phone: { $regex: safeSearch, $options: 'i' } },
      { email: { $regex: safeSearch, $options: 'i' } },
    ];
  }
  const skip = (page - 1) * limit;

  // 'qr' sorts customers who signed up via QR scan first (tagged 'qr_scan'
  // at creation time), then by newest \u2014 needs an aggregation since a plain
  // find().sort() can't rank by "does this array contain a value".
  if (sort === 'qr') {
    const total = await Customer.countDocuments(filter);
    const customers = await Customer.aggregate([
      { $match: filter },
      { $addFields: { _qrRank: { $cond: [{ $in: ['qr_scan', { $ifNull: ['$tags', []] }] }, 0, 1] } } },
      { $sort: { _qrRank: 1, added_at: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _qrRank: 0, __v: 0 } },
    ]);
    return res.json({ data: customers, total, page, limit, pages: Math.ceil(total / limit) });
  }

  const sortSpec = SORT_OPTIONS[sort] || SORT_OPTIONS.newest;
  const [total, customers] = await Promise.all([
    Customer.countDocuments(filter),
    Customer.find(filter).sort(sortSpec).skip(skip).limit(limit).select('-__v'),
  ]);
  res.json({ data: customers, total, page, limit, pages: Math.ceil(total / limit) });
};

// POST /api/customers
const createCustomer = async (req, res) => {
  const { name, phone, email, notes } = req.body;
  const filter = tenantFilter(req.user);

  if (req.user.role !== 'super_admin') {
    const business = await Business.findById(req.user.business_id).select('plan trial_ends_at plan_expires_at').lean();
    const limits = await getPlanLimits(getEffectivePlanSlug(business));
    const currentCount = await Customer.countDocuments(filter);
    if (currentCount >= limits.customers) {
      return lockedResponse(res, business, { kind: 'cap', feature: 'customers', limit: limits.customers });
    }
  }

  const existing = await Customer.findOne({
    ...filter,
    $or: [
      ...(phone ? [{ phone }] : []),
      ...(email ? [{ email }] : []),
    ],
  });
  if (existing) {
    return res.status(409).json({ error: 'A customer with this phone or email already exists.' });
  }
  const businessIdForCreate = req.user.role === 'super_admin' ? req.body.business_id : req.user.business_id;
  const locationId = await resolveActingLocationId(req, businessIdForCreate);
  const customer = await Customer.create({
    business_id: businessIdForCreate,
    location_id: locationId || null,
    name,
    phone: phone || null,
    email: email || null,
    notes: notes || null,
  });
  res.status(201).json({ data: customer });
};

// Server-side guard so a branch_manager can't read/edit/delete a customer
// tagged to a branch that isn't theirs by guessing an _id -- same
// "never leak into another branch's view" rule as everywhere else.
// Owners/super_admin are unrestricted (no extra filter). Returns null
// (meaning: deny) rather than throwing, since these callers already
// respond 404 either way, which also avoids revealing whether the
// customer exists at all in another branch.
async function singleCustomerScope(req) {
  if (req.user.role === 'owner' || req.user.role === 'super_admin') return {};
  const me = await User.findById(req.user.id).select('location_ids').lean();
  const myIds = ((me && me.location_ids) || []).map((id) => String(id));
  if (myIds.length === 0) return { location_id: { $in: [null] } };
  return { location_id: { $in: [...myIds, null] } };
}

// GET /api/customers/:id
const getCustomer = async (req, res) => {
  const scope = await singleCustomerScope(req);
  const customer = await Customer.findOne({
    _id: req.params.id,
    ...tenantFilter(req.user),
    ...scope,
  }).select('-__v');
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  res.json({ data: customer });
};

// PUT /api/customers/:id
const updateCustomer = async (req, res) => {
  const scope = await singleCustomerScope(req);
  const customer = await Customer.findOneAndUpdate(
    { _id: req.params.id, ...tenantFilter(req.user), ...scope },
    { $set: req.body },
    { new: true, runValidators: true }
  ).select('-__v');
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  res.json({ data: customer });
};

// DELETE /api/customers/:id
const deleteCustomer = async (req, res) => {
  const scope = await singleCustomerScope(req);
  const customer = await Customer.findOneAndDelete({
    _id: req.params.id,
    ...tenantFilter(req.user),
    ...scope,
  });
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  await ReviewRequest.deleteMany({
    customer_id: customer._id,
    status: { $in: ['sent', 'clicked'] },
  });
  res.json({ message: 'Customer deleted.' });
};

// POST /api/customers/import
const importCustomers = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const ext     = nodePath.extname(req.file.originalname).toLowerCase();
  const rawRows = [];

  //  --  Smart column detection  -- 
  // Recognises common header variations so users don't need exact column names.
  const NAME_ALIASES  = ['name', 'full name', 'fullname', 'customer name', 'contact name', 'customer', 'naam'];
  const PHONE_ALIASES = ['phone', 'phone number', 'phonenumber', 'mobile', 'mobile number', 'mobilenumber',
                         'mobile no', 'phone no', 'contact', 'contact no', 'whatsapp', 'mob', 'cell', 'telephone', 'ph'];
  const EMAIL_ALIASES = ['email', 'email address', 'emailaddress', 'mail', 'e-mail', 'gmail', 'email id'];

  const findCol = (headers, aliases) => {
    // 1. Exact match
    let idx = headers.findIndex(h => aliases.includes(h));
    if (idx !== -1) return idx;
    // 2. Partial match ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â header contains or is contained by an alias
    idx = headers.findIndex(h => aliases.some(a => h.includes(a) || a.includes(h)));
    return idx;
  };

  //  --  Parse  -- 
  if (ext === '.xlsx') {
    const readXlsxFile = require('read-excel-file/node');
    const stream       = new PassThrough();
    stream.end(req.file.buffer);
    const result = await readXlsxFile(stream);
    if (!result || result.length < 2) return res.json({ created: 0, skipped: 0, errors: [] });

    const headers  = result[0].map(h => String(h != null ? h : '').toLowerCase().trim());
    const nameIdx  = findCol(headers, NAME_ALIASES);
    const phoneIdx = findCol(headers, PHONE_ALIASES);
    const emailIdx = findCol(headers, EMAIL_ALIASES);
    if (nameIdx === -1 || phoneIdx === -1) {
      return res.status(400).json({ error: 'Could not find name and phone columns. Headers detected: ' + headers.join(', ') });
    }
    // read-excel-file returns numeric cells as JS Number.
    // Use Math.round().toString() so large phone numbers never become scientific notation.
    const cellStr = (val) => {
      if (val == null) return '';
      if (typeof val === 'number') return Math.round(val).toString();
      return String(val).trim();
    };
    for (let i = 1; i < result.length; i++) {
      const row = result[i];
      rawRows.push({
        name:   cellStr(row[nameIdx]),
        phone:  cellStr(row[phoneIdx]),
        email:  emailIdx >= 0 ? cellStr(row[emailIdx]) : '',
        rowNum: i + 1,
      });
    }
  } else {
    // CSV
    const text  = req.file.buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.json({ created: 0, skipped: 0, errors: [] });

    const headers  = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const nameIdx  = findCol(headers, NAME_ALIASES);
    const phoneIdx = findCol(headers, PHONE_ALIASES);
    const emailIdx = findCol(headers, EMAIL_ALIASES);
    if (nameIdx === -1 || phoneIdx === -1) {
      return res.status(400).json({ error: 'Could not find name and phone columns. Headers detected: ' + headers.join(', ') });
    }
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      rawRows.push({
        name:   cols[nameIdx]  || '',
        phone:  cols[phoneIdx] || '',
        email:  emailIdx >= 0 ? (cols[emailIdx] || '') : '',
        rowNum: i + 1,
      });
    }
  }

  //  --  Validate + normalise  -- 
  const E164          = /^\+\d{7,15}$/;
  const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const SCIENTIFIC_RE = /^[\d.]+[eE][+\-]?\d+$/;

  const normPhone = (p) => {
    const s      = String(p).trim();
    const digits = s.replace(/\D/g, '');
    if (digits.length === 10) return '+91' + digits;
    if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
    return s;
  };

  const errors     = [];
  const valid      = [];
  const seenInFile = new Set();

  for (const row of rawRows) {
    if (!row.name)  { errors.push({ row: row.rowNum, reason: 'Missing name' });  continue; }
    if (!row.phone) { errors.push({ row: row.rowNum, reason: 'Missing phone' }); continue; }

    // Scientific notation = Excel stored phone as number and lost digits.
    if (SCIENTIFIC_RE.test(row.phone)) {
      errors.push({
        row:    row.rowNum,
        reason: 'Phone stored as number in Excel (' + row.phone + '). Format the phone column as Text in Excel, re-enter the number, then re-save.',
      });
      continue;
    }

    const phone = normPhone(row.phone);
    if (!E164.test(phone)) {
      errors.push({ row: row.rowNum, reason: 'Invalid phone: ' + row.phone }); continue;
    }
    const email = row.email || null;
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ row: row.rowNum, reason: 'Invalid email: ' + email }); continue;
    }
    if (seenInFile.has(phone)) {
      errors.push({ row: row.rowNum, reason: 'Duplicate phone in file: ' + phone }); continue;
    }
    seenInFile.add(phone);
    valid.push({ name: row.name, phone, email });
  }

  if (valid.length === 0) return res.json({ created: 0, skipped: 0, errors });

  //  --  Deduplicate against DB  -- 
  const businessId  = req.user.business_id;
  const existing    = await Customer.find({
    business_id: businessId,
    phone: { $in: valid.map(r => r.phone) },
  }).select('phone').lean();
  const existingSet = new Set(existing.map(c => c.phone));

  const toCreate = [];
  let   skipped  = 0;
  for (const row of valid) {
    if (existingSet.has(row.phone)) {
      skipped++;
    } else {
      toCreate.push({ business_id: businessId, name: row.name, phone: row.phone, email: row.email });
    }
  }

  //  --  Bulk insert  --
  // The whole imported batch gets tagged with one location (whichever
  // branch the person running the import is acting from), same rule as a
  // single manual add -- not inferred per-row, since a CSV has no branch
  // column.
  const importLocationId = await resolveActingLocationId(req, businessId);
  let created = 0;
  if (toCreate.length > 0) {
    const rowsWithLocation = toCreate.map((row) => ({ ...row, location_id: importLocationId || null }));
    const inserted = await Customer.insertMany(rowsWithLocation, { ordered: false });
    created = inserted.length;
  }

  res.json({ created, skipped, errors });
};

// GET /api/customers/:id/requests
const getCustomerRequests = async (req, res) => {
  const scope = await singleCustomerScope(req);
  const customer = await Customer.findOne({
    _id: req.params.id,
    ...tenantFilter(req.user),
    ...scope,
  }).select('_id');
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const requests = await ReviewRequest.find({ customer_id: req.params.id })
    .sort({ sent_at: -1 })
    .limit(50)
    .select('channel status sent_at opened_at unique_token')
    .lean();
  res.json({ data: requests });
};

// GET /api/customers/export
const exportCustomers = async (req, res) => {
  const filter = tenantFilter(req.user);
  let locationFilter;
  try {
    locationFilter = await getLocationScopeFilter(req);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  Object.assign(filter, locationFilter);

  const customers = await Customer.find(filter)
    .sort({ added_at: -1 })
    .lean();
  const header = ['Name', 'Phone', 'Email', 'Status', 'Added Date', 'Notes'];
  const rows = customers.map(function(cu) {
    return [
      cu.name,
      cu.phone || '',
      cu.email || '',
      cu.opted_out ? 'Inactive' : 'Active',
      cu.added_at ? new Date(cu.added_at).toLocaleDateString('en-IN') : '',
      cu.notes || '',
    ];
  });
  const format = (req.query.format === 'pdf') ? 'pdf' : 'csv';
  var today = new Date().toISOString().slice(0, 10);

  if (format === 'pdf') {
    return sendBrandedPdf(res, {
      title: 'Customers Export',
      header: header,
      rows: rows,
      filename: 'customers-' + today + '.pdf',
    });
  }

  const csv = buildBrandedCsv('Customers Export', header, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="customers-' + today + '.csv"');
  res.send(csv);
};
// GET /api/customers/:id/reviews
const getCustomerReviews = async (req, res) => {
  const scope = await singleCustomerScope(req);
  const customer = await Customer.findOne({
    _id: req.params.id,
    ...tenantFilter(req.user),
    ...scope,
  }).select('_id');
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const reviews = await Review.find({ customer_id: customer._id })
    .sort({ created_at: -1 })
    .limit(50)
    .lean();
  res.json({ data: reviews });
};

// GET /api/customers/tags -- distinct custom segment tags currently in use
// for this business, so the Segment filter can offer any tag an owner has
// actually created, not just the three built-in ones.
const SYSTEM_TAGS = ['referral', 'qr_scan'];
const getCustomerTags = async (req, res) => {
  const filter = tenantFilter(req.user);
  let locationFilter;
  try {
    locationFilter = await getLocationScopeFilter(req);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  Object.assign(filter, locationFilter);

  const tags = await Customer.distinct('tags', filter);
  const custom = tags.filter((t) => t && SYSTEM_TAGS.indexOf(t) === -1).sort();
  res.json({ data: custom });
};

module.exports = {
  listCustomers,
  createCustomer,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  importCustomers,
  getCustomerRequests,
  getCustomerReviews,
  exportCustomers,
  getCustomerTags,
};
