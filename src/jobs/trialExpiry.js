'use strict';

const cron = require('node-cron');
const Business = require('../models/Business');

/**
 * Suspends any business still on the 'trial' plan whose trial_ends_at has
 * passed and isn't already suspended. Runs once a day at 03:00 server time
 * (low-traffic hour) so it never collides with peak usage.
 *
 * Safe to call multiple times — it's idempotent (only touches businesses
 * that are trial + expired + not already suspended).
 */
const suspendExpiredTrials = async () => {
  try {
    const result = await Business.updateMany(
      {
        plan: 'trial',
        trial_ends_at: { $lt: new Date() },
        is_suspended: false,
      },
      { $set: { is_suspended: true } }
    );

    if (result.modifiedCount > 0) {
      console.log(`[cron] Suspended ${result.modifiedCount} business(es) with expired trials.`);
    }
  } catch (err) {
    // Never let a cron failure crash the process.
    console.error('[cron] Trial-expiry job failed:', err.message);
  }
};

/**
 * Suspends any business on a paid plan (basic/pro/agency) whose
 * plan_expires_at has passed and isn't already suspended. This is the
 * paid-plan counterpart to suspendExpiredTrials — same idempotent
 * updateMany pattern, just checking plan_expires_at instead of
 * trial_ends_at and excluding the 'trial' plan itself (trials are handled
 * above and never carry a plan_expires_at value).
 *
 * Safe to call multiple times — only touches businesses that are on a
 * paid plan + have a plan_expires_at set + it has passed + not already
 * suspended.
 */
const suspendExpiredPaidPlans = async () => {
  try {
    const result = await Business.updateMany(
      {
        plan: { $ne: 'trial' },
        plan_expires_at: { $ne: null, $lt: new Date() },
        is_suspended: false,
      },
      { $set: { is_suspended: true } }
    );

    if (result.modifiedCount > 0) {
      console.log(`[cron] Suspended ${result.modifiedCount} business(es) with expired paid plans.`);
    }
  } catch (err) {
    // Never let a cron failure crash the process.
    console.error('[cron] Paid-plan-expiry job failed:', err.message);
  }
};

/**
 * Registers the daily schedule. Call this once from server.js after the
 * DB connection is established — not from app.js, so it never runs during
 * tests that only import the Express app.
 */
const startTrialExpiryJob = () => {
  // Run once immediately on boot too, so a business that expired while the
  // server was asleep/restarting gets caught right away instead of waiting
  // up to 24h for the next scheduled run.
  suspendExpiredTrials();
  suspendExpiredPaidPlans();

  cron.schedule('0 3 * * *', () => {
    suspendExpiredTrials();
    suspendExpiredPaidPlans();
  });
  console.log('[cron] Trial-expiry and paid-plan-expiry jobs scheduled (daily at 03:00).');
};

module.exports = { startTrialExpiryJob, suspendExpiredTrials, suspendExpiredPaidPlans };