'use strict';
const Business = require('../models/Business');
const SupportChat = require('../models/SupportChat');
const SuccessStory = require('../models/SuccessStory');

async function getActionCenter(req, res) {
  const items = [];
  try {
    const paymentIssues = await Business.find({ payment_status: 'failed', payment_failure_count: { $gte: 1 } }).select('_id business_name').limit(5);
    paymentIssues.forEach(b => {
      items.push({
        title: b.business_name || 'Business',
        description: 'Payment failed',
        status: 'resolve',
        buttonLabel: 'Resolve',
        href: '/dashboard/admin/businesses/' + b._id
      });
    });
    res.json({ items, count: items.length, last_updated: new Date() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load action center' });
  }
}

async function getBusinessHealth(req, res) {
  try {
    const businesses = await Business.find({ deleted_at: null }).select('_id business_name plan plan_expires_at last_activity').lean();
    const now = new Date();
    let healthy = 0, attention = 0, at_risk = 0;
    const at_risk_list = [];
    
    businesses.forEach(b => {
      let status = 'healthy';
      let reason = null;
      if (b.plan && b.plan_expires_at) {
        const daysLeft = Math.floor((new Date(b.plan_expires_at) - now) / (24*60*60*1000));
        if (daysLeft < 0) {
          status = 'at_risk';
          reason = 'Plan expired ' + Math.abs(daysLeft) + 'd ago';
        } else if (daysLeft <= 7) {
          status = 'attention';
        }
      }
      if (status === 'healthy') healthy++;
      else if (status === 'attention') attention++;
      else {
        at_risk++;
        at_risk_list.push({ id: b._id, name: b.business_name, reason: reason || 'At risk' });
      }
    });
    res.json({ healthy, attention, at_risk, at_risk_list: at_risk_list.slice(0, 10), total_businesses: businesses.length, last_updated: new Date() });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
}

module.exports = { getActionCenter, getBusinessHealth };
