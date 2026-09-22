'use strict';
const Joi = require('joi');

const submitReviewSchema = Joi.object({
  rating:   Joi.number().integer().min(1).max(5).required(),
  feedback: Joi.string().trim().min(1).max(2000).optional().allow('', null),
});

const listReviewsSchema = Joi.object({
  rating:      Joi.number().integer().min(1).max(5).optional(),
  channel:     Joi.string().valid('whatsapp', 'sms', 'email', 'qr').optional(),
  tag:         Joi.string().trim().max(40).optional(),
  stage:       Joi.string().valid('new', 'in_progress').optional(),
  search:      Joi.string().trim().max(100).optional().allow(''),
  start_date:  Joi.date().iso().optional(),
  end_date:    Joi.date().iso().optional(),
  sort:        Joi.string().valid('newest', 'oldest', 'rating_high', 'rating_low').default('newest'),
  is_resolved: Joi.boolean().optional(),
  page:        Joi.number().integer().min(1).default(1),
  limit:       Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { submitReviewSchema, listReviewsSchema };