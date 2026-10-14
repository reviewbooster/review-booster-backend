'use strict';
/**
 * repair-locations.js
 * Phase 1 repair script -- run this instead of migrate-to-locations.js.
 *
 * inspect-locations.js revealed that real Location documents already exist
 * in the database, left over from an earlier (since reverted-in-code)
 * multi-location build. That old build used a boolean `is_active` field
 * and, on at least one business, a `branch_staff` role string -- neither
 * exists in the fresh Phase 1 schema, so this script repairs the gap
 * instead of creating new/duplicate data.
 *
 * This script is ADDITIVE ONLY. It never deletes a Location, a Review, a
 * ReviewRequest, or a User, and it never overwrites a field that's already
 * correctly set. It only:
 *
 *   1. For every existing Location missing a `status` field, sets
 *      status: 'active' (or 'inactive' if the old is_active was false).
 *      This is the critical fix: public.controller.js's getQrReview()
 *      filters on { qr_token, status: 'active' }. Every existing Location
 *      document right now has NO status field at all (confirmed by
 *      inspect-locations.js), so none of them match that filter --
 *      meaning if Phase 1 code goes live as-is, EVERY existing QR code
 *      (including the ones already printed/scanned) would start returning
 *      "Invalid QR code." This step fixes that before anything goes live.
 *   2. For any Business with ZERO Location documents, creates one default
 *      Location (same logic as the original migrate script). Not expected
 *      to run for any of the 4 current businesses -- kept so this script
 *      stays safe to re-run later if a new business ever has no Location.
 *   3. Renames any User whose role is anything other than
 *      'owner' / 'branch_manager' / 'super_admin' (e.g. the leftover
 *      'branch_staff' found on Sanket Unisex Salon, or an old 'staff') to
 *      'branch_manager'.
 *   4. For any user with no location_ids at all, assigns the business's
 *      default location. Never overwrites an existing non-empty array
 *      (e.g. Sanket's Staff user already correctly points at its real
 *      location and is left untouched).
 *   5. For any user with no active_location_id, sets it to the business's
 *      default location.
 *   6. Backfills location_id on any ReviewRequest/Review that still has
 *      location_id: null, pointing it at the business's default location.
 *      Never touches a document that already has a location_id set.
 *
 * Safe to re-run any number of times -- every step only fills in what's
 * missing.
 *
 * Usage (from the backend repo root):
 *   node repair-locations.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Business      = require('./src/models/Business');
const User          = require('./src/models/User');
const Location       = require('./src/models/Location');
const ReviewRequest = require('./src/models/ReviewRequest');
const Review         = require('./src/models/Review');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const VALID_ROLES = ['owner', 'branch_manager', 'super_admin'];

async function run() {
  if (!MONGO_URI) {
    console.error('No MONGODB_URI / MONGO_URI found in environment (.env). Aborting -- nothing was touched.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');

  const businesses = await Business.find({}).lean();
  console.log('Found ' + businesses.length + ' businesses.');
  console.log('');

  for (const business of businesses) {
    console.log('=== ' + business.name + ' (' + business._id + ') ===');

    let locations = await Location.find({ business_id: business._id });

    if (locations.length === 0) {
      const created = await Location.create({
        business_id: business._id,
        name: business.name || 'Main Location',
        status: 'active',
        is_default: true,
        qr_token: business.qr_token || undefined,
        google_review_url: business.google_review_url || null,
        brand_logo_url: business.brand_logo_url || null,
      });
      console.log('  No Location existed -- created default: ' + created._id);
      locations = [created];
    }

    // Step 1: backfill missing status on every Location this business has.
    //
    // IMPORTANT: this uses raw collection-level updateMany(), not
    // Location.find() + doc.save(). Mongoose applies a schema's `default`
    // in memory the moment it hydrates a document that's missing that
    // field -- even though the field still doesn't exist in the actual
    // database row. That makes `loc.status` read back as 'active' already
    // on a doc that has NO status field at all, so a find()+save() check
    // like `if (loc.status !== 'active') ...` silently never fires and
    // never persists anything. updateMany() works directly against the
    // raw stored document and has no such masking, so it's the only
    // reliable way to detect and fix a genuinely-missing field.
    const statusActiveResult = await Location.collection.updateMany(
      { business_id: business._id, status: { $exists: false }, is_active: { $ne: false } },
      { $set: { status: 'active' } }
    );
    const statusInactiveResult = await Location.collection.updateMany(
      { business_id: business._id, status: { $exists: false }, is_active: false },
      { $set: { status: 'inactive' } }
    );
    const statusFixedCount = statusActiveResult.modifiedCount + statusInactiveResult.modifiedCount;
    if (statusFixedCount > 0) {
      console.log('  Fixed missing status field on ' + statusFixedCount + ' Location document(s).');
      // Re-fetch so the rest of this business's processing below (which
      // reads loc.is_default / loc._id) sees current data. Status itself
      // isn't used again after this point, so this re-fetch is just hygiene.
      locations = await Location.find({ business_id: business._id });
    } else {
      console.log('  Location status field already correct on all documents.');
    }

    // Default location for this business -- used to backfill users,
    // requests and reviews that have no location pointer at all.
    const defaultLocation = locations.find((l) => l.is_default) || locations[0];

    // Steps 3-5: repair Users.
    const users = await User.find({ business_id: business._id });
    for (const user of users) {
      let changed = false;

      if (!VALID_ROLES.includes(user.role)) {
        console.log('  Fixing user role: ' + user.email + ' "' + user.role + '" -> "branch_manager"');
        user.role = 'branch_manager';
        changed = true;
      }

      if (!user.location_ids || user.location_ids.length === 0) {
        user.location_ids = [defaultLocation._id];
        changed = true;
      }

      if (!user.active_location_id) {
        user.active_location_id = defaultLocation._id;
        changed = true;
      }

      if (changed) {
        await user.save();
        console.log('  Updated user: ' + user.email);
      }
    }

    // Step 6: backfill only genuinely-unset location_id on historical records.
    const rrResult = await ReviewRequest.updateMany(
      { business_id: business._id, location_id: null },
      { $set: { location_id: defaultLocation._id } }
    );
    const revResult = await Review.updateMany(
      { business_id: business._id, location_id: null },
      { $set: { location_id: defaultLocation._id } }
    );
    console.log('  Backfilled location_id on ' + rrResult.modifiedCount + ' ReviewRequest(s), ' + revResult.modifiedCount + ' Review(s).');
    console.log('');
  }

  console.log('Done. No documents were deleted.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Repair failed -- check the log above for what already completed before the error:', err);
  process.exit(1);
});
