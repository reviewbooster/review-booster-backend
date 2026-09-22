'use strict';
/**
 * followup.controller.js
 * Each customer has at most one *open* follow-up at a time -- scheduling
 * a new one while an open one exists reschedules it (upsert), rather than
 * piling up duplicates. "Reminders" are in-app only (this data plus the
 * existing notification bell) -- there's no automated messaging to the
 * customer here, same limitation as everywhere else in the app.
 */
const FollowUp = require('../models/FollowUp');
const Customer = require('../models/Customer');

async function ownedCustomer(customerId, business_id) {
  return Customer.findOne({ _id: customerId, business_id }).select('_id name').lean();
}

// GET /api/customers/:id/follow-up
const getNextFollowUp = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) return res.status(403).json({ error: 'No business associated with this account.' });

  const customer = await ownedCustomer(req.params.id, business_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const followUp = await FollowUp.findOne({ business_id, customer_id: customer._id, status: 'open' })
    .sort({ due_date: 1 })
    .lean();
  res.json({ data: followUp || null });
};

// PUT /api/customers/:id/follow-up -- create or reschedule
const setFollowUp = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) return res.status(403).json({ error: 'No business associated with this account.' });

  const customer = await ownedCustomer(req.params.id, business_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const { due_date, note } = req.body;
  const parsedDate = new Date(due_date);
  if (!due_date || isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'A valid due date is required.' });
  }
  const cleanNote = (note || '').trim().slice(0, 300);

  const followUp = await FollowUp.findOneAndUpdate(
    { business_id, customer_id: customer._id, status: 'open' },
    {
      $set: { due_date: parsedDate, note: cleanNote, notified: false },
      $setOnInsert: { business_id, customer_id: customer._id, status: 'open', created_at: new Date() },
    },
    { upsert: true, new: true }
  );
  res.json({ data: followUp });
};

// POST /api/customers/:id/follow-up/complete
const completeFollowUp = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) return res.status(403).json({ error: 'No business associated with this account.' });

  const customer = await ownedCustomer(req.params.id, business_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const followUp = await FollowUp.findOneAndUpdate(
    { business_id, customer_id: customer._id, status: 'open' },
    { $set: { status: 'done', completed_at: new Date() } },
    { new: true }
  );
  if (!followUp) return res.status(404).json({ error: 'No open follow-up for this customer.' });
  res.json({ data: followUp });
};

// DELETE /api/customers/:id/follow-up -- cancel without marking done
const cancelFollowUp = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) return res.status(403).json({ error: 'No business associated with this account.' });

  const customer = await ownedCustomer(req.params.id, business_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  await FollowUp.deleteOne({ business_id, customer_id: customer._id, status: 'open' });
  res.json({ data: { deleted: true } });
};

// GET /api/follow-ups?status=due|upcoming|done -- the Follow-up inbox
const listFollowUps = async (req, res) => {
  const business_id = req.user.business_id;
  if (!business_id) return res.status(403).json({ error: 'No business associated with this account.' });

  const statusParam = ['due', 'upcoming', 'done'].indexOf(req.query.status) !== -1 ? req.query.status : 'due';
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const filter = { business_id };
  let sortSpec;
  if (statusParam === 'done') {
    filter.status = 'done';
    sortSpec = { completed_at: -1 };
  } else if (statusParam === 'upcoming') {
    filter.status = 'open';
    filter.due_date = { $gt: todayEnd };
    sortSpec = { due_date: 1 };
  } else {
    filter.status = 'open';
    filter.due_date = { $lte: todayEnd };
    sortSpec = { due_date: 1 };
  }

  const followUps = await FollowUp.find(filter)
    .sort(sortSpec)
    .limit(200)
    .populate('customer_id', 'name phone email opted_out')
    .lean();

  res.json({ data: followUps });
};

module.exports = { getNextFollowUp, setFollowUp, completeFollowUp, cancelFollowUp, listFollowUps };
