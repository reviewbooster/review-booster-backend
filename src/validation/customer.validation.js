'use strict';
const Joi = require('joi');

// Create — phone OR email required (need at least one to send a request)
const createCustomerSchema = Joi.object({
  name:  Joi.string().trim().min(1).max(100).required(),
  phone: Joi.string().trim().pattern(/^\+[1-9]\d{6,14}$/).message('Phone must be in E.164 format, e.g. +919876543210').optional().allow('', null),
  email: Joi.string().trim().email().lowercase().optional().allow('', null),
  notes: Joi.string().trim().max(500).optional().allow('', null),
}).or('phone', 'email');

// Update — all optional, but at least one field must be sent
const updateCustomerSchema = Joi.object({
  name:  Joi.string().trim().min(1).max(100).optional(),
  phone: Joi.string().trim().pattern(/^\+[1-9]\d{6,14}$/).message('Phone must be in E.164 format, e.g. +919876543210').optional().allow('', null),
  email: Joi.string().trim().email().lowercase().optional().allow('', null),
  notes: Joi.string().trim().max(500).optional().allow('', null),
}).min(1);

// List — query params
const listCustomersSchema = Joi.object({
  search: Joi.string().trim().max(100).optional().allow(''),
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(20),
  sort:   Joi.string().valid('newest', 'oldest', 'name_asc', 'name_desc').default('newest'),
});

module.exports = { createCustomerSchema, updateCustomerSchema, listCustomersSchema };