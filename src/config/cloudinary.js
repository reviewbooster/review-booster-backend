'use strict';

const cloudinary = require('cloudinary').v2;

// CLOUDINARY_URL env var (cloudinary://key:secret@cloudname) is auto-read by
// the SDK if set. As a fallback, also support three separate env vars.
if (!process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

module.exports = cloudinary;