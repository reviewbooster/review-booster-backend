'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * tasks collection
 * A plain admin to-do list -- can stand alone, or point at a business when
 * it was created from an action item / health signal (e.g. "follow up with
 * X about their lapsed plan"). Nothing here is auto-created yet; the admin
 * adds every task by hand.
 */
const TaskSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'title is required'],
      trim: true,
      maxlength: 300,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['open', 'completed'],
      default: 'open',
    },
    related_business_id: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    related_business_name: {
      type: String,
      trim: true,
      default: null,
    },
    created_by_name: {
      type: String,
      trim: true,
      default: null,
    },
    completed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

TaskSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model('Task', TaskSchema);