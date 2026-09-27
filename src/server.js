'use strict';

/**
 * server.js â€” HTTP server entry point
 *
 * Imports the configured Express app and binds it to a port.
 * Separation from app.js allows tests to import app without binding a port.
 */

require('dotenv').config();

const app = require('./app');
const { startTrialExpiryJob } = require('./jobs/trialExpiry');
const { startFollowUpReminderJob } = require('./jobs/followupReminders');

const PORT = parseInt(process.env.PORT || '5000', 10);

const server = app.listen(PORT, () => {
  console.log(`[server] ReviewBooster API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  // Auto-suspension retired -- expiry is now enforced live via
  // getEffectivePlanSlug() in planLimits.js (falls back to the "Expired"
  // plan's feature limits) instead of a nightly job flipping is_suspended.
  // startTrialExpiryJob();
  startFollowUpReminderJob();
});

//  -- 
// Graceful shutdown
//  -- 
const shutdown = (signal) => {
  console.log(`\n[server] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[server] HTTP server closed.');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes > 10s
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled promise rejections â€” log and exit so Railway restarts
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
  process.exit(1);
});

// Catch uncaught exceptions â€” log and exit
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  process.exit(1);
});

module.exports = server;