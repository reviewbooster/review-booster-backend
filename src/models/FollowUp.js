'use strict';
/**
 * src/models/FollowUp.js
 * One open follow-up task per customer at a time -- scheduling a new one
 * while an open one exists reschedules it rather than creating a second.
 * See src/controllers/followup.controller.js.
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

const FollowUpSchema = new Schema({
  business_id: {
    type: Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
    index: true,
  },
  customer_id: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true,
  },
  due_date: {
    type: Date,
    required: true,
  },
  note: {
    type: String,
    trim: true,
    maxlength: 300,
    default: '',
  },
  status: {
    type: String,
    enum: ['open', 'done'],
    default: 'open',
  },
  // Set true once the daily reminder job has notified the business about
  // this follow-up being due -- prevents re-notifying every day it stays
  // overdue. Reset to false whenever the follow-up is (re)scheduled, so a
  // rescheduled date gets its own fresh reminder.
  notified: {
    type: Boolean,
    default: false,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  completed_at: {
    type: Date,
    default: null,
  },
});

FollowUpSchema.index({ business_id: 1, customer_id: 1, status: 1 });
FollowUpSchema.index({ business_id: 1, status: 1, due_date: 1 });

module.exports = mongoose.model('FollowUp', FollowUpSchema);
