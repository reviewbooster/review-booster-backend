'use strict';
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Schema } = mongoose;

const LocationSchema = new Schema(
  {
    business_id: { type: Schema.Types.ObjectId, ref: 'Business', required: [true, 'business_id is required'] },
    name: { type: String, required: [true, 'Location name is required'], trim: true },
    address: { type: String, trim: true, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    is_default: { type: Boolean, default: false },
    // unique + sparse declared ONCE here at the field level. (The previous
    // version of this file also declared a separate LocationSchema.index()
    // call below for the same field, which is what caused the Mongoose
    // "Duplicate schema index on {qr_token:1}" warning -- removed.)
    qr_token: { type: String, unique: true, sparse: true, default: () => crypto.randomBytes(16).toString('hex') },
    google_review_url: { type: String, trim: true, default: null },
    brand_logo_url: { type: String, trim: true, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

LocationSchema.index({ business_id: 1 });
LocationSchema.index({ business_id: 1, status: 1 });

module.exports = mongoose.model('Location', LocationSchema);
