'use strict';
const Joi = require('joi');

// Public submit — rating required, feedback required only for 1-3 stars (enforced in controller)
const submitReviewSchema = Joi.object({
  rating:   Joi.number().integer().min(1).max(5).required(),
  feedback: Joi.string().trim().min(1).max(2000).optional().allow('', null),
});

// List reviews / feedback — query params
const listReviewsSchema = Joi.object({
  rating:      Joi.number().integer().min(1).max(5).optional(),
  channel:     Joi.string().valid('whatsapp', 'sms', 'email').optional(),
  is_resolved: Joi.boolean().optional(),
  page:        Joi.number().integer().min(1).default(1),
  limit:       Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { submitReviewSchema, listReviewsSchema };