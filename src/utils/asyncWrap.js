'use strict';

/**
 * asyncWrap
 * Wraps async route handlers so any rejected promise is forwarded
 * to Express next(err) — letting the global errorHandler catch it.
 * This eliminates try/catch from every controller.
 *
 * Usage: router.get('/', asyncWrap(myAsyncController));
 */
const asyncWrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncWrap;