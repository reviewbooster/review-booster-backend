'use strict';

const mongoose = require('mongoose');

const qrTemplateSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 300, default: '' },
  image_data:  { type: String, required: true },
  mime_type:   { type: String, required: true },
  created_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  created_at:  { type: Date, default: Date.now },
});

module.exports = mongoose.model('QrTemplate', qrTemplateSchema);