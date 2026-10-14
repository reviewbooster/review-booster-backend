'use strict';
/**
 * backfill-customer-locations.js
 * One-time backfill for the Customers branch-tagging change.
 *
 * Every existing Customer has location_id: null. For a business with
 * exactly one Location, it's safe to assume every existing customer
 * belongs to that location -- same assumption repair-locations.js and
 * backfill-referral-locations.js already make.
 *
 * For a business with more than one Location (several of yours already
 * do), there's no stored branch on the Customer itself to fall back on,
 * so this makes a best-effort guess from that customer's own history:
 * their earliest ReviewRequest or Review that has a location_id set.
 * That's a reasonable proxy -- it's wherever they first interacted with
 * the business -- but it IS a guess, not a certainty, since the customer
 * record itself never recorded which branch they were added at. Anyone
 * with no located ReviewRequest/Review at all is left as location_id:
 * null (shown as "unknown branch") rather than guessed wrong.
 *
 * Safe to re-run: only touches customers that still have location_id: null.
 *
 * Usage (from the backend repo root, after deploying the customer code):
 *   node backfill-customer-locations.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const Business      = require('./src/models/Business');
const Location       = require('./src/models/Location');
const Customer       = require('./src/models/Customer');
const ReviewRequest  = require('./src/models/ReviewRequest');
const Review         = require('./src/models/Review');

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

    const unassigned = await Customer.find({ business_id: business._id, location_id: null }).select('_id').lean();
    if (unassigned.length === 0) {
      console.log('  No unassigned customers -- nothing to do.');
      console.log('');
      continue;
    }

    const locations = await Location.find({ business_id: business._id }).select('_id').lean();
    if (locations.length === 0) {
      console.log('  No Location documents found for this business yet -- skipping (run repair-locations.js first).');
      console.log('');
      continue;
    }

    if (locations.length === 1) {
      const result = await Customer.updateMany(
        { business_id: business._id, location_id: null },
        { $set: { location_id: locations[0]._id } }
      );
      console.log('  Backfilled location_id on ' + result.modifiedCount + ' customer(s) to the single existing location.');
      console.log('');
      continue;
    }

    // Multiple locations: best-effort guess per customer from their
    // earliest located ReviewRequest or Review.
    let guessed = 0;
    let leftUnknown = 0;
    for (const cust of unassigned) {
      const [req1, rev1] = await Promise.all([
        ReviewRequest.findOne({ customer_id: cust._id, location_id: { $ne: null } })
          .sort({ sent_at: 1 }).select('location_id').lean(),
        Review.findOne({ customer_id: cust._id, location_id: { $ne: null } })
          .sort({ created_at: 1 }).select('location_id').lean(),
      ]);
      const guess = (req1 && req1.location_id) || (rev1 && rev1.location_id) || null;
      if (guess) {
        await Customer.updateOne({ _id: cust._id }, { $set: { location_id: guess } });
        guessed++;
      } else {
        leftUnknown++;
      }
    }
    console.log('  ' + locations.length + ' locations exist -- guessed branch from review-request/review history for ' +
      guessed + ' customer(s); left ' + leftUnknown + ' as "unknown branch" (no located history found).');
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
