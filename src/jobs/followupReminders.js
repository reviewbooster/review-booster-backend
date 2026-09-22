'use strict';

const cron = require('node-cron');
const FollowUp = require('../models/FollowUp');
const { createNotification } = require('../utils/notificationHelper');

/**
 * Notifies each business, once, when a follow-up becomes due (or was
 * already overdue and hasn't been notified about yet). One digest
 * notification per business per sweep, not one per follow-up, so a
 * business with several due follow-ups doesn't get spammed.
 *
 * Idempotent: only touches follow-ups where notified is still false, and
 * marks them true right after sending, so re-running never double-sends.
 * Rescheduling a follow-up resets notified to false (see
 * followup.controller.js setFollowUp), so a new due date gets its own
 * fresh reminder rather than staying silent forever.
 */
const notifyDueFollowUps = async () => {
  try {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const due = await FollowUp.find({
      status: 'open',
      due_date: { $lte: todayEnd },
      notified: false,
    }).select('_id business_id').lean();

    if (due.length === 0) return;

    const countsByBusiness = {};
    due.forEach((f) => {
      const key = String(f.business_id);
      countsByBusiness[key] = (countsByBusiness[key] || 0) + 1;
    });

    for (const business_id of Object.keys(countsByBusiness)) {
      const count = countsByBusiness[business_id];
      await createNotification({
        business_id,
        type: 'follow_up_due',
        title: count === 1 ? '1 follow-up due today' : count + ' follow-ups due today',
        message: 'Check your Follow-ups to see who needs a reminder.',
        entity_type: 'follow_up',
      });
    }

    await FollowUp.updateMany(
      { status: 'open', due_date: { $lte: todayEnd }, notified: false },
      { $set: { notified: true } }
    );

    console.log(`[cron] Sent follow-up reminders for ${Object.keys(countsByBusiness).length} business(es).`);
  } catch (err) {
    // Never let a cron failure crash the process.
    console.error('[cron] Follow-up reminder job failed:', err.message);
  }
};

/**
 * Registers the daily schedule. Call this once from server.js after the
 * DB connection is established -- not from app.js, so it never runs
 * during tests that only import the Express app.
 */
const startFollowUpReminderJob = () => {
  // Run once immediately on boot too, so anything that became due while
  // the server was asleep/restarting gets caught right away instead of
  // waiting up to 24h for the next scheduled run.
  notifyDueFollowUps();

  // 08:00 server time -- unlike the trial-expiry job (deliberately at a
  // quiet hour since nobody needs to see it happen), this one is timed so
  // owners actually see it when they start their day.
  cron.schedule('0 8 * * *', () => {
    notifyDueFollowUps();
  });
  console.log('[cron] Follow-up reminder job scheduled (daily at 08:00).');
};

module.exports = { startFollowUpReminderJob, notifyDueFollowUps };
