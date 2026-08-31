'use strict';

/**
 * asyncWrap
 * Wraps an async route handler so that any rejected promise is forwarded
 * to Express's next(err) without needing try/catch in every controller.
 *
 * Usage:
 *   router.post('/login', asyncWrap(loginController));
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise
 * @returns {Function} Wrapped handler that forwards errors to next()
 */
const asyncWrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * globalErrorHandler
 * Must be registered LAST in app.js after all routes:
 *   app.use(globalErrorHandler);
 *
 * Handles:
 *  - Mongoose duplicate key (11000) → 409 Conflict
 *  - Mongoose validation errors     → 400 Bad Request
 *  - JWT errors forwarded manually  → already handled in auth.js
 *  - Everything else                → 500 Internal Server Error
 */
const globalErrorHandler = (err, req, res, _next) => {   // 4-arg signature required by Express
  // Mongoose duplicate key error (e.g. unique email on User)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] ?? 'field';
    return res.status(409).json({ error: `A record with that ${field} already exists.` });
  }

  // Mongoose schema validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join('; ');
    return res.status(400).json({ error: message });
  }

  // Mongoose cast error (e.g. invalid ObjectId in URL param)
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid ${err.path}: ${err.value}` });
  }

  // Default — log and return generic message (never expose stack in production)
  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Something went wrong. We have been notified.'
      : err.message;

  if (status >= 500) {
    console.error('[error]', err);
  }

  return res.status(status).json({ error: message });
};

module.exports = { asyncWrap, globalErrorHandler };
