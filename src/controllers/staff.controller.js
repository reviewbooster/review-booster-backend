'use strict';
/**
 * staff.controller.js
 * The "who served this customer" staff directory — plain names, no login,
 * completely optional. Not to be confused with staff LOGIN accounts (see
 * business.controller.js listStaff/createStaff/deleteStaff), which are a
 * separate access-control feature.
 */
const mongoose     = require('mongoose');
const StaffMember  = require('../models/StaffMember');
const Review       = require('../models/Review');

// GET /api/staff-directory — owner or staff (anyone who might use a picker)
const listStaffMembers = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const staff = await StaffMember.find({ business_id }).sort({ name: 1 }).select('name created_at');
  res.json({ data: staff });
};

// POST /api/staff-directory — owner only
const createStaffMember = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const staffMember = await StaffMember.create({ business_id, name: name.trim() });
  res.status(201).json({ data: staffMember });
};

// DELETE /api/staff-directory/:id — owner only
// Deliberately does NOT touch past Review/ReviewRequest/ReferralSignup
// records — their served_by/resolved_by/redeemed_by names are denormalized
// strings, so history is preserved even after a directory entry is removed.
const deleteStaffMember = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }
  const staffMember = await StaffMember.findOneAndDelete({ _id: req.params.id, business_id });
  if (!staffMember) {
    return res.status(404).json({ error: 'Staff directory entry not found.' });
  }
  res.json({ data: { ok: true } });
};

// GET /api/staff-directory/stats — owner only
// Simple per-name rollup: customers handled, positive/negative feedback %,
// and how many public (Google-bound) reviews they generated. Matched by
// name against the denormalized Review.served_by field.
const getStaffStats = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) {
    return res.status(403).json({ error: 'No business associated with this account.' });
  }

  const staffList = await StaffMember.find({ business_id }).sort({ name: 1 }).lean();

  const rows = await Review.aggregate([
    { $match: { business_id: new mongoose.Types.ObjectId(business_id), served_by: { $ne: null } } },
    {
      $group: {
        _id: '$served_by',
        customers_handled: { $sum: 1 },
        positive: { $sum: { $cond: ['$is_public', 1, 0] } },
        negative: { $sum: { $cond: ['$is_public', 0, 1] } },
      },
    },
  ]);

  const byName = {};
  rows.forEach((r) => { byName[r._id] = r; });

  const data = staffList.map((s) => {
    const row = byName[s.name] || { customers_handled: 0, positive: 0, negative: 0 };
    const total = row.customers_handled || 0;
    return {
      _id: s._id,
      name: s.name,
      customers_handled: total,
      positive_pct: total > 0 ? Math.round((row.positive / total) * 100) : 0,
      negative_pct: total > 0 ? Math.round((row.negative / total) * 100) : 0,
      reviews_generated: row.positive,
    };
  });

  res.json({ data });
};

module.exports = { listStaffMembers, createStaffMember, deleteStaffMember, getStaffStats };
