'use strict';

const QrTemplate = require('../models/QrTemplate');
const asyncWrap  = require('../utils/asyncWrap');

// GET /api/qr-templates — any authenticated user
exports.getTemplates = asyncWrap(async (req, res) => {
  const templates = await QrTemplate.find({}).sort({ created_at: -1 });
  res.json({ data: templates });
});

// POST /api/qr-templates — admin only, multer upload
exports.uploadTemplate = asyncWrap(async (req, res) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const { title, description } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required.' });
  }
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowed.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are allowed.' });
  }
  const template = await QrTemplate.create({
    title:       title.trim(),
    description: description ? description.trim() : '',
    image_data:  req.file.buffer.toString('base64'),
    mime_type:   req.file.mimetype,
    created_by:  req.user._id || req.user.id,
  });
  res.status(201).json({ data: template });
});

// DELETE /api/qr-templates/:id — admin only
exports.deleteTemplate = asyncWrap(async (req, res) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const template = await QrTemplate.findByIdAndDelete(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found.' });
  res.json({ message: 'Template deleted.' });
});