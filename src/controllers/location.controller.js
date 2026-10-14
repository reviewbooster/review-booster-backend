'use strict';
/**
 * src/controllers/location.controller.js
 *
 * GET    /api/locations        -- list locations the current user is
 *                                  authorized to see.
 *                                    owner / super_admin -> every Location
 *                                      for their business.
 *                                    branch_manager       -> only the
 *                                      Locations in their location_ids.
 * PATCH  /api/locations/active -- set the current user's active_location_id
 *                                  to a location they are actually
 *                                  authorized for (Phase 2 -- backs the
 *                                  mandatory branch selector).
 *
 * Phase 3 (Locations and Team, spec section 7) additions -- owner only:
 * POST   /api/locations        -- create a new location.
 * PATCH  /api/locations/:id    -- edit name/address/overrides, change
 *                                  status, or make it the default.
 *
 * Deliberately NOT implemented: hard delete. A location can be live
 * history (reviews, a printed/already-scanned QR code) the moment it's
 * created, so "remove" here means deactivate (status: 'inactive'), never
 * erase the document -- spec section 7's "safe deactivation/removal
 * flows ... and appropriate data-handling rules". A location's own
 * qr_token is also never reissued by this controller -- QR codes printed
 * for an existing location must keep resolving exactly as they always
 * have (see public.controller.js getQrReview).
 *
 * IMPORTANT: req.user (set by middleware/auth.js from the JWT) only
 * carries {id, business_id, role, name} -- the access token was never
 * extended with location_ids, and re-signing every token on every
 * location reassignment isn't worth the complexity here. Handlers that
 * need a non-owner's authorized locations re-fetch the live User document
 * instead of trusting the token, so access reflects the database right
 * now, not whatever it was up to 15 minutes ago when they logged in.
 */
const Location = require('../models/Location');
const User     = require('../models/User');

// GET /api/locations
const listMyLocations = async (req, res) => {
  const { business_id, role } = req.user;

  let query = { business_id };
  if (role !== 'owner' && role !== 'super_admin') {
    // branch_manager (or any future non-owner role) only sees what they're
    // explicitly assigned -- never the whole business by default (spec
    // section 8: "Branch managers must not gain organization-wide access
    // by default").
    const me = await User.findById(req.user.id).select('location_ids').lean();
    query._id = { $in: (me && me.location_ids) || [] };
  }

  const locations = await Location.find(query)
    .select('name address status is_default google_review_url brand_logo_url')
    .sort({ is_default: -1, name: 1 })
    .lean();

  res.json({ data: locations });
};

// PATCH /api/locations/active
const setActiveLocation = async (req, res) => {
  const { location_id } = req.body;
  if (!location_id) {
    return res.status(400).json({ error: 'location_id is required.' });
  }

  const { business_id, role } = req.user;

  // Must belong to this business, and -- for anyone other than an
  // owner/super_admin -- must be one of their explicitly assigned
  // locations. This is the server-side half of the "mandatory branch
  // selection" rule: the frontend shows only authorized locations, but
  // this check is what actually enforces it (spec section 8 security
  // rule: "Enforce permissions in backend services and APIs, not only by
  // hiding menu items in the interface").
  const location = await Location.findOne({ _id: location_id, business_id }).lean();
  if (!location) {
    return res.status(404).json({ error: 'Location not found.' });
  }
  if (role !== 'owner' && role !== 'super_admin') {
    const me = await User.findById(req.user.id).select('location_ids').lean();
    const allowed = ((me && me.location_ids) || []).some((id) => String(id) === String(location_id));
    if (!allowed) {
      return res.status(403).json({ error: 'You are not authorized for that location.' });
    }
  }

  await User.updateOne({ _id: req.user.id }, { $set: { active_location_id: location._id } });

  res.json({ data: { active_location_id: location._id } });
};

// POST /api/locations -- owner only (enforced by roleGuard in the route).
const createLocation = async (req, res) => {
  const { name, address, google_review_url, brand_logo_url } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Location name is required.' });
  }
  if (google_review_url && !String(google_review_url).startsWith('https://')) {
    return res.status(400).json({ error: 'Google review URL must start with https://.' });
  }

  const location = await Location.create({
    business_id: req.user.business_id,
    name: name.trim(),
    address: address ? String(address).trim() : null,
    status: 'active',
    is_default: false, // a new location is never auto-made default -- an
                        // explicit PATCH {is_default:true} is required, so
                        // an owner never loses track of which branch their
                        // existing QR materials/settings point to.
    google_review_url: google_review_url ? String(google_review_url).trim() : null,
    brand_logo_url: brand_logo_url ? String(brand_logo_url).trim() : null,
    // qr_token: left to the schema's own random default -- this is a brand
    // new location, so there is no existing QR code to preserve.
  });

  res.status(201).json({ data: location });
};

// PATCH /api/locations/:id -- owner only (enforced by roleGuard in the route).
const updateLocation = async (req, res) => {
  const { id } = req.params;
  const location = await Location.findOne({ _id: id, business_id: req.user.business_id });
  if (!location) {
    return res.status(404).json({ error: 'Location not found.' });
  }

  const { name, address, google_review_url, brand_logo_url, status, is_default } = req.body;

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Location name cannot be empty.' });
    location.name = name.trim();
  }
  if (address !== undefined) {
    location.address = address ? String(address).trim() : null;
  }
  if (google_review_url !== undefined) {
    const trimmed = (google_review_url || '').trim();
    if (trimmed && !trimmed.startsWith('https://')) {
      return res.status(400).json({ error: 'Google review URL must start with https://.' });
    }
    location.google_review_url = trimmed || null;
  }
  if (brand_logo_url !== undefined) {
    location.brand_logo_url = (brand_logo_url || '').trim() || null;
  }

  if (status !== undefined) {
    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'." });
    }
    if (status === 'inactive' && location.is_default) {
      // Never let the default location go dark without a replacement --
      // it's what new QR scans / settings fall back to. Make another
      // location the default first (a separate PATCH {is_default:true}).
      return res.status(400).json({ error: 'Set a different default location before deactivating this one.' });
    }
    location.status = status;
  }

  if (is_default === true && !location.is_default) {
    // Exactly one default per business -- unset it on every other
    // location for this business before setting it here.
    await Location.updateMany(
      { business_id: req.user.business_id, _id: { $ne: location._id } },
      { $set: { is_default: false } }
    );
    location.is_default = true;
    location.status = 'active'; // a default location must be active
  }

  await location.save();

  res.json({ data: location });
};

module.exports = { listMyLocations, setActiveLocation, createLocation, updateLocation };
