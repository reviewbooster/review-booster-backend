'use strict';
/**
 * adminSuccessStory.controller.js
 * The Super Admin side of Success Stories: one workspace for the whole
 * pipeline (Potential -> Invited -> Submitted -> Under review -> Changes
 * needed -> Approved / Rejected). Admins can see the owner's answers, the
 * results frozen at submission, and the exact consent given; edit the
 * presentation copy; and decide. Every decision is kept in the story's own
 * trail and in the audit log. Route-level super_admin guard is applied in
 * admin.routes.js.
 */
const SuccessStory = require('../models/SuccessStory');
const Business     = require('../models/Business');
const { logAction } = require('./auditLog.controller');

const STATUSES = SuccessStory.STATUSES;

// A business is "potential" once its own typed-in Google numbers show real
// growth since their starting point.
const MIN_REVIEW_GAIN = 10;
const MIN_RATING_GAIN = 0.2;

const TRANSITIONS = {
  start_review:    { from: ['submitted'],                to: 'under_review' },
  request_changes: { from: ['submitted', 'under_review'], to: 'changes_needed', needsNote: true },
  approve:         { from: ['submitted', 'under_review'], to: 'approved' },
  reject:          { from: ['submitted', 'under_review'], to: 'rejected' },
  reopen:          { from: ['approved', 'rejected'],     to: 'under_review' },
};

function clip(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function actor(req) {
  const u = req.user || {};
  return { user_id: u._id || u.id || null, name: u.name || u.owner_name || null, email: u.email || null };
}

function grantedPermissions(story) {
  const p = story.consent && story.consent.permissions;
  if (!p) return [];
  return Object.keys(p).filter(function (k) { return p[k] === true; });
}

function row(story) {
  const snap = story.results_snapshot || {};
  const google = snap.google || {};
  return {
    _id: story._id,
    business: story.business_id && story.business_id._id
      ? { _id: story.business_id._id, name: story.business_id.name, type: story.business_id.type }
      : { _id: story.business_id, name: 'Unknown business', type: null },
    status: story.status,
    submitted_at: story.submitted_at,
    updated_at: story.updated_at,
    google: { baseline: google.baseline || null, current: google.current || null },
    permissions: grantedPermissions(story),
  };
}

// GET /api/admin/success-stories?status=
const listStories = async (req, res) => {
  const filter = {};
  if (req.query.status && STATUSES.indexOf(req.query.status) !== -1) filter.status = req.query.status;

  const [stories, counts] = await Promise.all([
    SuccessStory.find(filter).sort({ updated_at: -1 }).limit(200).populate('business_id', 'name type').lean(),
    SuccessStory.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const countMap = {};
  counts.forEach(function (c) { countMap[c._id] = c.n; });
  res.json({ data: { stories: stories.map(row), counts: countMap } });
};

// GET /api/admin/success-stories/potential -- businesses whose own numbers show growth
const listPotential = async (req, res) => {
  const existing = await SuccessStory.find({}).select('business_id').lean();
  const have = {};
  existing.forEach(function (s) { have[String(s.business_id)] = true; });

  const businesses = await Business.find({
    'google_numbers.baseline.review_count': { $ne: null },
    'google_numbers.updates.0': { $exists: true },
    is_suspended: false,
  }).select('name type google_numbers').limit(500).lean();

  const rows = [];
  businesses.forEach(function (b) {
    if (have[String(b._id)]) return;
    const base = b.google_numbers.baseline;
    const ups = b.google_numbers.updates || [];
    const cur = ups[ups.length - 1];
    if (!base || !cur) return;
    const gain = cur.review_count - base.review_count;
    const ratingGain = (cur.rating != null && base.rating != null) ? Math.round((cur.rating - base.rating) * 10) / 10 : null;
    if (gain >= MIN_REVIEW_GAIN || (ratingGain !== null && ratingGain >= MIN_RATING_GAIN)) {
      rows.push({
        business: { _id: b._id, name: b.name, type: b.type },
        google: { baseline: base, current: cur },
        review_gain: gain,
        rating_gain: ratingGain,
      });
    }
  });
  rows.sort(function (a, b) { return b.review_gain - a.review_gain; });
  res.json({ data: rows, rules: { min_review_gain: MIN_REVIEW_GAIN, min_rating_gain: MIN_RATING_GAIN } });
};

// GET /api/admin/success-stories/:id
const getStory = async (req, res) => {
  const story = await SuccessStory.findById(req.params.id).populate('business_id', 'name type plan').lean();
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  res.json({ data: Object.assign({}, story, { row: row(story) }) });
};

// POST /api/admin/success-stories/invite  { business_id }
const inviteBusiness = async (req, res) => {
  const business = await Business.findById((req.body || {}).business_id).select('name').lean();
  if (!business) return res.status(404).json({ error: 'Business not found.' });
  const existing = await SuccessStory.findOne({ business_id: business._id }).select('_id').lean();
  if (existing) return res.status(409).json({ error: 'This business already has a story record.' });

  const story = await SuccessStory.create({ business_id: business._id, status: 'invited' });
  await logAction(req, {
    action: 'success_story.invite',
    target_type: 'Business',
    target_label: business.name,
    metadata: { story_id: String(story._id) },
  });
  res.json({ data: { _id: story._id, status: story.status } });
};

// PATCH /api/admin/success-stories/:id
// body: { action, note?, presentation?: { headline, quote } }
// action 'save_copy' only saves the presentation copy; the others move the story.
const decideStory = async (req, res) => {
  const body = req.body || {};
  const story = await SuccessStory.findById(req.params.id).populate('business_id', 'name');
  if (!story) return res.status(404).json({ error: 'Story not found.' });

  const note = clip(body.note, 1000);

  if (body.presentation) {
    story.presentation = {
      headline: clip(body.presentation.headline, 120),
      quote:    clip(body.presentation.quote, 600),
    };
  }

  if (body.action === 'save_copy') {
    await story.save();
    return res.json({ data: { _id: story._id, status: story.status } });
  }

  const t = TRANSITIONS[body.action];
  if (!t) return res.status(400).json({ error: 'Unknown action.' });
  if (t.from.indexOf(story.status) === -1) {
    return res.status(409).json({ error: 'A story that is "' + story.status + '" cannot be moved this way.' });
  }
  if (t.needsNote && !note) {
    return res.status(400).json({ error: 'Add a short note telling the owner what to change.' });
  }
  if (body.action === 'approve' && grantedPermissions(story).length === 0) {
    return res.status(409).json({ error: 'The owner has not granted any permission, so there is nothing to approve.' });
  }

  const from = story.status;
  story.status = t.to;
  story.admin_note = body.action === 'request_changes' ? note : null;
  story.decision_log.push({ action: body.action, from: from, to: t.to, note: note || null, by: actor(req), at: new Date() });
  await story.save();

  await logAction(req, {
    action: 'success_story.' + body.action,
    target_type: 'Business',
    target_label: story.business_id && story.business_id.name ? story.business_id.name : String(story.business_id),
    metadata: { story_id: String(story._id), from: from, to: t.to, note: note || null },
  });
  res.json({ data: { _id: story._id, status: story.status } });
};

module.exports = { listStories, listPotential, getStory, inviteBusiness, decideStory };