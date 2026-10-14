'use strict';
/**
 * backfill-referral-locations.js
 * One-time backfill for the referral branch-attribution change.
 *
 * ReferralSignup now carries a location_id, but every signup recorded
 * before this change has location_id: null. For any business that has
 * exactly one Location (the normal case right after the Owner Dashboard
 * migration/repair), it's safe to assume every historical referral
 * redemption happened at that one location, so this backfills them --
 * the same assumption migrate-to-locations.js / repair-locations.js
 * already made for ReviewRequest/Review.
 *
 * For a business with more than one Location by the time this runs,
 * there's no way to know which branch an old redemption happened at --
 * those are deliberately left as location_id: null (shown as "unknown
 * branch" rather than guessed) and this script says so in its output.
 *
 * Safe to re-run: only touches documents that still have location_id: null.
 *
 * Usage (from the backend repo root, after deploying the referral code):
 *   node backfill-referral-locations.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const Business        = require('./src/models/Business');
const Location         = require('./src/models/Location');
const ReferralSignup   = require('./src/models/ReferralSignup');

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('No MONGODB_URI / MONGO_URI found in environment (.env). Aborting -- nothing was touched.');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');

  const businesses = await Business.find({}).select('_id name').lean();
  console.log('Found ' + businesses.length + ' businesses.');
  console.log('');

  for (const business of businesses) {
    console.log('=== ' + business.name + ' (' + business._id + ') ===');

    const locations = await Location.find({ business_id: business._id }).select('_id is_default').lean();
    const unassignedCount = await ReferralSignup.countDocuments({ business_id: business._id, location_id: null });

    if (unassignedCount === 0) {
      console.log('  No unassigned referral signups -- nothing to do.');
      console.log('');
      continue;
    }

    if (locations.length === 0) {
      console.log('  No Location documents found for this business yet -- skipping (run repair-locations.js first).');
      console.log('');
      continue;
    }

    if (locations.length > 1) {
      console.log('  ' + locations.length + ' locations exist -- cannot safely guess which branch ' +
        unassignedCount + ' historical referral(s) belong to. Left as location_id: null (shown as "unknown branch").');
      console.log('');
      continue;
    }

    const onlyLocation = locations[0];
    const result = await ReferralSignup.updateMany(
      { business_id: business._id, location_id: null },
      { $set: { location_id: onlyLocation._id } }
    );
    console.log('  Backfilled location_id on ' + result.modifiedCount + ' ReferralSignup(s) to the single existing location.');
    console.log('');
  }

  console.log('Done. No documents were deleted.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Backfill failed -- check the log above for what already completed before the error:', err);
  process.exit(1);
});
