const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    business_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['new_feedback', 'new_review'],
      required: true,
    },
    title:       { type: String, required: true },
    message:     { type: String, required: true },
    entity_id:   { type: mongoose.Schema.Types.ObjectId, default: null },
    entity_type: { type: String, enum: ['review', 'feedback', null], default: null },
    is_read:     { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

// Auto-delete after 90 days
notificationSchema.index({ created_at: 1 }, { expireAfterSeconds: 7776000 });

module.exports = mongoose.model('Notification', notificationSchema);