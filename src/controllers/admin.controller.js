'use strict';
const Business = require('../models/Business');
const User     = require('../models/User');
const { asyncWrap }                              = require('../middleware/errorHandler');
const { sendApprovalEmail, sendRejectionEmail }  = require('../utils/mailer');

// GET /api/admin/pending-count
const getPendingCount = asyncWrap(async (req, res) => {
  const count = await Business.countDocuments({ approval_status: 'pending' });
  return res.json({ count });
});

// GET /api/admin/businesses?status=pending|approved|rejected
const getBusinesses = asyncWrap(async (req, res) => {
  const status = req.query.status || 'pending';
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
  const skip   = (page - 1) * limit;

  const [businesses, total] = await Promise.all([
    Business.find({ approval_status: status })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Business.countDocuments({ approval_status: status }),
  ]);

  const ids    = businesses.map(b => b._id);
  const owners = await User.find({ business_id: { $in: ids }, role: 'owner' })
    .select('business_id name email')
    .lean();

  const ownerMap = {};
  owners.forEach(o => { ownerMap[o.business_id.toString()] = o; });

  const result = businesses.map(b => ({
    ...b,
    owner: ownerMap[b._id.toString()] || null,
  }));

  return res.json({ businesses: result, total, page, pages: Math.ceil(total / limit) });
});

// PUT /api/admin/businesses/:id/approve
const approveBusiness = asyncWrap(async (req, res) => {
  const business = await Business.findByIdAndUpdate(
    req.params.id,
    { approval_status: 'approved' },
    { new: true }
  );
  if (!business) return res.status(404).json({ error: 'Business not found.' });

  const owner = await User.findOne({ business_id: business._id, role: 'owner' }).lean();
  if (owner) {
    try {
      await sendApprovalEmail(owner.email, owner.name, business.name);
    } catch (e) {
      console.error('[ADMIN] Approval email failed:', e.message);
    }
  }

  return res.json({ message: 'Business approved.', business });
});

// PUT /api/admin/businesses/:id/reject
const rejectBusiness = asyncWrap(async (req, res) => {
  const business = await Business.findByIdAndUpdate(
    req.params.id,
    { approval_status: 'rejected' },
    { new: true }
  );
  if (!business) return res.status(404).json({ error: 'Business not found.' });

  const owner = await User.findOne({ business_id: business._id, role: 'owner' }).lean();
  if (owner) {
    try {
      await sendRejectionEmail(owner.email, owner.name, business.name);
    } catch (e) {
      console.error('[ADMIN] Rejection email failed:', e.message);
    }
  }

  return res.json({ message: 'Business rejected.', business });
});

module.exports = { getPendingCount, getBusinesses, approveBusiness, rejectBusiness };