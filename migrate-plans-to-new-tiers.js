'use strict';
/**
 * migrate-plans-to-new-tiers.js
 * One-time migration: moves every Business off the old plan slugs
 * (trial/basic/pro/agency) onto the new permanent tiers
 * (free/starter/growth/pro). Run once, after deploying the Stage 3 code
 * change, from the backend repo root:
 *
 *   node migrate-plans-to-new-tiers.js
 *
 * Safe to re-run -- only touches businesses still on an old slug, so a
 * second run is a no-op. Never blocks or deletes anything; a business
 * that would land over its new tier's caps just gets a printed warning
 * so you can review it manually before Stage 4 enforcement goes live.
 *
 * Mapping:
 *   trial  -> free    (trial_ends_at is left untouched, so any remaining
 *                       trial window still grants Growth-level access)
 *   basic  -> starter
 *   pro    -> pro      (same name, but the caps behind it change -- see
 *                       utils/planLimits.js)
 *   agency -> pro      (agency had unlimited customers/staff; pro has
 *                       real caps, hence the over-limit warning below)
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // same Jio/WARP workaround as the main app

const mongoose    = require('mongoose');
const Business    = require('./src/models/Business');
const Customer    = require('./src/models/Customer');
const StaffMember = require('./src/models/StaffMember');
const { PLAN_LIMITS } = require('./src/utils/planLimits');

const SLUG_MAP = {
  trial:  'free',
  basic:  'starter',
  pro:    'pro',
  agency: 'pro',
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set — make sure you run this from the backend repo root.');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB.');

  const businesses = await Business.find({ plan: { $in: Object.keys(SLUG_MAP) } });
  console.log('Found', businesses.length, 'business(es) on an old plan slug.');

  let migrated = 0;
  let warned = 0;

  for (const business of businesses) {
    const oldSlug = business.plan;
    const newSlug = SLUG_MAP[oldSlug];
    const newLimits = PLAN_LIMITS[newSlug];

    const [customerCount, staffCount] = await Promise.all([
      Customer.countDocuments({ business_id: business._id }),
      StaffMember.countDocuments({ business_id: business._id }),
    ]);

    if (newLimits.customers !== Infinity && customerCount > newLimits.customers) {
      console.warn('  WARNING: "' + business.name + '" (' + business._id + ') has ' + customerCount + ' customers, over the new ' + newSlug + ' cap of ' + newLimits.customers + '. Review manually.');
      warned++;
    }
    if (newLimits.staff !== Infinity && staffCount > newLimits.staff) {
      console.warn('  WARNING: "' + business.name + '" (' + business._id + ') has ' + staffCount + ' staff, over the new ' + newSlug + ' cap of ' + newLimits.staff + '. Review manually.');
      warned++;
    }

    business.plan = newSlug;
    await business.save();
    migrated++;
    console.log('  ' + business.name + ': ' + oldSlug + ' -> ' + newSlug);
  }

  console.log('Done. Migrated', migrated, 'business(es),', warned, 'warning(s) printed above.');
  console.log('Nothing is enforced differently yet from this alone -- Stage 4 is what wires real gating to these new tiers.');

  await mongoose.disconnect();
}

main().catch(function (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
});