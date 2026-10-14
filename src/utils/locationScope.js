'use strict';
/**
 * src/utils/locationScope.js
 *
 * Shared location-scoping logic for every analytics/reviews endpoint that
 * needs to respect per-branch access (Owner Dashboard spec section 8:
 * "Enforce permissions in backend services and APIs, not only by hiding
 * menu items in the interface").
 *
 *   owner / super_admin -- sees the whole business by default; an optional
 *     ?location_id= query param narrows to one specific location (still
 *     validated: must belong to this business -- handled by the caller
 *     combining this with their own tenantFilter).
 *   anyone else (branch_manager today) -- ALWAYS scoped to their own
 *     assigned location_ids (re-fetched from the live User document --
 *     the JWT doesn't carry location_ids), regardless of any location_id
 *     query param they might pass. Documents with location_id: null
 *     (legacy data from before this field existed, or channels that
 *     aren't location-aware yet) are included in their default view so
 *     pre-existing history doesn't disappear for them. If they explicitly
 *     ask for one of their own locations via ?location_id=, that narrows
 *     further to just that one location (no null documents mixed in,
 *     since they asked for one specific branch).
 *
 * Previously, every analytics/reviews endpoint scoped only by business_id
 * -- a branch_manager saw the ENTIRE business's data, not just their own
 * assigned branch. This is the fix for that gap, used consistently across
 * analytics.controller.js and review.controller.js (and anything later,
 * like Campaigns) instead of duplicating the logic per file.
 *
 * Throws { statusCode, message } on an invalid or unauthorized
 * location_id -- callers translate that to a response themselves (most of
 * these functions don't have `res` handy at the point they call this).
 */
const mongoose = require('mongoose');
const User = require('../models/User');

const getLocationScopeFilter = async (req) => {
  const requestedId = req.query.location_id;

  if (req.user.role === 'owner' || req.user.role === 'super_admin') {
    if (!requestedId) return {};
    if (!mongoose.Types.ObjectId.isValid(requestedId)) {
      const err = new Error('Invalid location_id.');
      err.statusCode = 400;
      throw err;
    }
    return { location_id: new mongoose.Types.ObjectId(requestedId) };
  }

  // branch_manager (or any future non-owner, non-super_admin role).
  const me = await User.findById(req.user.id).select('location_ids').lean();
  const myIds = ((me && me.location_ids) || []).map((id) => String(id));

  if (requestedId) {
    if (!mongoose.Types.ObjectId.isValid(requestedId) || !myIds.includes(String(requestedId))) {
      const err = new Error('You are not authorized for that location.');
      err.statusCode = 403;
      throw err;
    }
    return { location_id: new mongoose.Types.ObjectId(requestedId) };
  }

  if (myIds.length === 0) {
    // No location assigned yet -- show nothing rather than silently
    // falling back to the whole business.
    return { location_id: { $in: [null] } };
  }

  return { location_id: { $in: [...myIds.map((id) => new mongoose.Types.ObjectId(id)), null] } };
};

module.exports = { getLocationScopeFilter };
