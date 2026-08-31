'use strict';
const Joi = require('joi');

/**
 * validate middleware factory
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates req.body against a Joi schema. Returns 400 with the first
 * human-readable error message if validation fails.
 *
 * Usage:
 *   const { loginSchema } = require('../validators/auth.validators');
 *   router.post('/login', validate(loginSchema), loginController);
 * ─────────────────────────────────────────────────────────────────────────────
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: true,    // stop at first error — cleaner for API consumers
    stripUnknown: true,  // drop undeclared fields to prevent mass-assignment
  });
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  // Replace req.body with the sanitised/coerced value from Joi
  req.body = value;
  return next();
};

/**
 * validateQuery middleware factory
 * ─────────────────────────────────────────────────────────────────────────────
 * Same as validate() but targets req.query instead of req.body.
 * Stores the validated result in req.validatedQuery so controllers
 * get correct types (page/limit as numbers, booleans coerced, etc.)
 *
 * Usage:
 *   router.get('/', validateQuery(listSchema), asyncWrap(listController));
 * ─────────────────────────────────────────────────────────────────────────────
 */
const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, {
    abortEarly: true,
    stripUnknown: true,
    convert: true, // coerces "1" → 1 for page/limit integers
  });
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  req.validatedQuery = value; // controllers read from req.validatedQuery
  return next();
};

// Default export kept for backward compat — auth routes use:
//   const validate = require('../middleware/validate')
// New routes use named imports:
//   const { validate, validateQuery } = require('../middleware/validate')
module.exports = validate;
module.exports.validate = validate;
module.exports.validateQuery = validateQuery;
