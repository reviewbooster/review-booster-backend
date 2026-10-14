'use strict';
/**
 * inspect-locations.js
 * Read-only diagnostic -- prints every existing Location document next to
 * its parent Business's current qr_token/google_review_url/brand_logo_url,
 * so we can see whether leftover data from an earlier multi-location
 * build is compatible with the fresh Phase 1 model, before trusting
 * migrate-to-locations.js's "already has a default location" skip logic.
 *
 * Makes NO changes. Safe to run any time.
 *
 * Usage (from the backend repo root):
 *   node inspect-locations.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Business = require('./src/models/Business');
const Location = require('./src/models/Location');
const User     = require('./src/models/User');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function run() {
  if (!MONGO_URI) {
    console.error('No MONGODB_URI / MONGO_URI found in environment (.env). Aborting.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');
  console.log('');

  const businesses = await Business.find({}).lean();

  for (const business of businesses) {
    console.log('=== Business: ' + business.name + '  (' + business._id + ') ===');
    console.log('  Business.qr_token:           ' + business.qr_token);
    console.log('  Business.google_review_url:  ' + business.google_review_url);
    console.log('  Business.brand_logo_url:     ' + business.brand_logo_url);

    const locations = await Location.find({ business_id: business._id }).lean();
    console.log('  Location documents found: ' + locations.length);
    for (const loc of locations) {
      console.log('    ---');
      console.log('    _id:               ' + loc._id);
      console.log('    name:               ' + loc.name);
      console.log('    is_default:         ' + loc.is_default);
      console.log('    status:             ' + loc.status);
      console.log('    qr_token:           ' + loc.qr_token);
      console.log('    qr_token MATCHES Business.qr_token: ' + (loc.qr_token === business.qr_token));
      console.log('    google_review_url:  ' + loc.google_review_url);
      console.log('    brand_logo_url:     ' + loc.brand_logo_url);
      console.log('    created_at:         ' + loc.created_at);
      // Dump any other fields this old doc might carry that the new
      // Location schema above doesn't even define, so nothing is hidden.
      const knownFields = ['_id','business_id','name','address','status','is_default','qr_token','google_review_url','brand_logo_url','created_at','updated_at','__v'];
      const extraFields = Object.keys(loc).filter((k) => !knownFields.includes(k));
      if (extraFields.length) {
        console.log('    EXTRA fields not in the new schema: ' + JSON.stringify(extraFields));
        extraFields.forEach((k) => console.log('      ' + k + ': ' + JSON.stringify(loc[k])));
      }
    }

    const users = await User.find({ business_id: business._id }).select('name email role location_ids active_location_id').lean();
    console.log('  User documents: ' + users.length);
    for (const u of users) {
      console.log('    - ' + u.name + ' (' + u.email + ')  role=' + u.role + '  location_ids=' + JSON.stringify(u.location_ids) + '  active_location_id=' + u.active_location_id);
    }
    console.log('');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
