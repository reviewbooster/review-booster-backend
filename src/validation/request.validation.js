'use strict';
const Joi = require('joi');

// Send a review request
const sendRequestSchema = Joi.object({
  customer_id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  channel:     Joi.string().valid('whatsapp', 'sms', 'email').required(),
});

// List sent requests — query params
const listRequestsSchema = Joi.object({
  customer_id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  channel:     Joi.string().valid('whatsapp', 'sms', 'email').optional(),
  status:      Joi.string().valid('sent', 'clicked', 'completed').optional(),
  page:        Joi.number().integer().min(1).default(1),
  limit:       Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { sendRequestSchema, listRequestsSchema };