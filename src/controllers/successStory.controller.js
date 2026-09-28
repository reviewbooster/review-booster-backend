'use strict';
/**
 * successStory.controller.js
 * The owner's side of Success Stories: a short form (results are attached
 * automatically), plus explicit, separate permissions. Consent is versioned
 * and logged -- who agreed, when, to what, under which wording -- and can be
 * withdrawn at any time. Nothing is published from here; a super admin
 * reviews and approves stories separately.
 */
const SuccessStory  = require('../models/SuccessStory');
const { buildResults } = require('../utils/resultsSnapshot');

const CONSENT = {
  version: 'v1',
  statements: {
    testimonial:   "Use my written testimonial in ReviewBooster's marketing.",
    business_name: 'Show my business name alongside it.',
    results:       'Show my before/after results (Google reviews and rating, and my ReviewBooster activity).',
    logo:          'Use my business logo.',
  },
  declaration:
    "I confirm I'm authorised to give these permissions for this business. I understand nothing is " +
    'published until ReviewBooster approves it, and that I can withdraw my permission at any time.',
};
const PERMISSION_KEYS = Object.keys(CONSENT.statements);

// While a story is with the team (or already decided) the owner can't edit it.
const LOCKED = ['under_review', 'approved', 'rejected'];

function shape(story) {
  if (!story) return null;
  return {
    status:           story.status,
    what_changed:     story.what_changed,
    happiest_result:  story.happiest_result,
    testimonial:      story.testimonial,
    results_snapshot: story.results_snapshot,
    consent:          story.consent,
    submitted_at:     story.submitted_at,
    withdrawn_at:     story.withdrawn_at,
    admin_note:       story.admin_note,
  };
}

function giver(req) {
  const u = req.user || {};
  return {
    user_id: u._id || u.id || null,
    name:    u.name || u.owner_name || null,
    email:   u.email || null,
  };
}

// GET /api/business/my-success-story -- owner only
const getMyStory = async (req, res) => {
  const story = await SuccessStory.findOne({ business_id: req.user.business_id }).lean();
  const results = await buildResults(req.user.business_id);
  res.json({
    data: {
      story: shape(story),
      consent: CONSENT,
      results: results,
      has_baseline: !!(results && results.google && results.google.baseline),
      locked: !!(story && LOCKED.indexOf(story.status) !== -1),
    },
  });
};

// PUT /api/business/my-success-story -- owner only. Creates or updates the
// story and records the consent given with it.
const saveMyStory = async (req, res) => {
  const body = req.body || {};
  const whatChanged    = String(body.what_changed || '').trim();
  const happiestResult = String(body.happiest_result || '').trim();
  const testimonial    = String(body.testimonial || '').trim();

  if (whatChanged.length < 10 || whatChanged.length > 1000) {
    return res.status(400).json({ error: 'Tell us what changed after using ReviewBooster (10 to 1000 characters).' });
  }
  if (happiestResult.length < 3 || happiestResult.length > 500) {
    return res.status(400).json({ error: 'Tell us which result you are happiest with (up to 500 characters).' });
  }
  if (testimonial.length > 1500) {
    return res.status(400).json({ error: 'Your testimonial is too long (1500 characters at most).' });
  }

  const sent = body.permissions || {};
  const permissions = {};
  PERMISSION_KEYS.forEach(function (k) { permissions[k] = sent[k] === true; });
  if (!PERMISSION_KEYS.some(function (k) { return permissions[k]; })) {
    return res.status(400).json({ error: 'Tick at least one thing you are happy for us to use.' });
  }
  if (permissions.testimonial && !testimonial) {
    return res.status(400).json({ error: 'Write your testimonial, or untick the testimonial permission.' });
  }
  if (body.accepted_declaration !== true) {
    return res.status(400).json({ error: 'Please confirm the declaration to continue.' });
  }

  const results = await buildResults(req.user.business_id);
  if (!results || !results.google.baseline) {
    return res.status(400).json({ error: 'Enter your starting Google numbers first.' });
  }

  const existing = await SuccessStory.findOne({ business_id: req.user.business_id }).select('status').lean();
  if (existing && LOCKED.indexOf(existing.status) !== -1) {
    return res.status(409).json({ error: 'This story is already with our team, so it can no longer be edited.' });
  }

  const now = new Date();
  const entry = {
    version: CONSENT.version,
    given_at: now,
    given_by: giver(req),
    permissions: permissions,
    declaration: CONSENT.declaration,
  };

  const story = await SuccessStory.findOneAndUpdate(
    { business_id: req.user.business_id },
    {
      $set: {
        status: 'submitted',
        what_changed: whatChanged,
        happiest_result: happiestResult,
        testimonial: testimonial,
        results_snapshot: results,
        consent: entry,
        submitted_at: now,
        withdrawn_at: null,
        admin_note: null,
      },
      $push: { consent_log: entry },
    },
    { upsert: true, new: true }
  ).lean();

  res.json({ data: shape(story) });
};

// DELETE /api/business/my-success-story -- owner only. Withdraws permission.
// The story and the full consent trail are kept; the withdrawal is logged.
const withdrawMyStory = async (req, res) => {
  const story = await SuccessStory.findOne({ business_id: req.user.business_id }).select('status').lean();
  if (!story) {
    return res.status(404).json({ error: 'You have not shared a story yet.' });
  }
  if (story.status === 'withdrawn') {
    return res.json({ data: { status: 'withdrawn' } });
  }

  const now = new Date();
  const none = {};
  PERMISSION_KEYS.forEach(function (k) { none[k] = false; });
  const entry = {
    version: CONSENT.version,
    given_at: now,
    given_by: giver(req),
    permissions: none,
    declaration: 'Permission withdrawn by the owner.',
  };

  await SuccessStory.updateOne(
    { business_id: req.user.business_id },
    { $set: { status: 'withdrawn', withdrawn_at: now, consent: entry }, $push: { consent_log: entry } }
  );
  res.json({ data: { status: 'withdrawn' } });
};

module.exports = { getMyStory, saveMyStory, withdrawMyStory };