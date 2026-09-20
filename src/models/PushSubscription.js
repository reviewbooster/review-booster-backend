const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

pushSubscriptionSchema.index({ user_id: 1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);