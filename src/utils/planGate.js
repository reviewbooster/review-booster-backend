'use strict';
/**
 * planGate.js
 * The one place that turns "this business isn't allowed to do that right now"
 * into a clear, specific message -- what happened (plan expired, trial ended,
 * monthly limit used up, or simply not included) and what to do about it.
 * Every plan/usage lock in the API responds through lockedResponse(), so the
 * wording and the response shape are identical everywhere. The frontend keys
 * off code: 'PLAN_LOCKED' to show the notice and a "See plans" button.
 */
const { getEffectivePlanSlug } = require('./planLimits');

const PAID_PLANS = ['starter', 'growth', 'pro', 'basic', 'agency'];
const PLAN_NAMES = { free: 'Free', starter: 'Starter', growth: 'Growth', pro: 'Pro', basic: 'Basic', agency: 'Agency', trial: 'Free', expired: 'Free' };

const FEATURE_NAMES = {
  analytics:         'Advanced Analytics',
  custom_templates:  'Custom message templates',
  win_back:          'Win-Back',
  win_back_contacts: 'Win-Back',
  engine_a:          'Customer referrals',
  engine_b:          'Refer a Business',
  ai_reply:          'AI reply drafts',
  ai_replies:        'AI reply drafts',
  follow_ups:        'Follow-up reminders',
  sms:               'SMS',
  staff:             'Staff accounts',
  customers:         'Customer records',
  review_requests:   'Review requests',
};

const NOUNS = {
  review_requests:   'review requests',
  sms:               'SMS messages',
  ai_replies:        'AI reply generations',
  follow_ups:        'follow-ups',
  win_back_contacts: 'Win-Back contacts',
  customers:         'customers',
  staff:             'staff accounts',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRIAL_MEMORY_DAYS = 30; // mention "your trial ended" for a month, then just say what the plan includes

// Dates are shown in Indian time regardless of where the server runs.
function istParts(date) {
  const t = new Date(new Date(date).getTime() + 5.5 * 60 * 60 * 1000);
  return { d: t.getUTCDate(), m: t.getUTCMonth(), y: t.getUTCFullYear() };
}
function fmtDate(date) {
  const p = istParts(date);
  return p.d + ' ' + MONTHS[p.m] + ' ' + p.y;
}
function nextMonthStart() {
  const p = istParts(new Date());
  return '1 ' + MONTHS[(p.m + 1) % 12];
}
function fmtNum(n) {
  return Number(n).toLocaleString('en-IN');
}

// Why is this business on a lower tier than it used to be, if it is?
function lapseInfo(business) {
  if (!business) return null;
  const now = Date.now();
  if (PAID_PLANS.indexOf(business.plan) !== -1 && business.plan_expires_at &&
      new Date(business.plan_expires_at).getTime() < now) {
    return {
      reason: 'lapsed',
      text: 'Your ' + (PLAN_NAMES[business.plan] || '') + ' plan expired on ' + fmtDate(business.plan_expires_at) + '. ',
    };
  }
  if ((business.plan === 'free' || business.plan === 'trial') && business.trial_ends_at) {
    const ended = new Date(business.trial_ends_at).getTime();
    if (ended < now && now - ended < TRIAL_MEMORY_DAYS * 24 * 60 * 60 * 1000) {
      return { reason: 'trial_ended', text: 'Your free trial ended on ' + fmtDate(business.trial_ends_at) + '. ' };
    }
  }
  return null;
}

/**
 * Sends the 403. `business` needs plan / trial_ends_at / plan_expires_at.
 * opts.kind:
 *   'feature' -- the plan doesn't include this at all
 *   'quota'   -- a monthly allowance is used up (opts.limit = the allowance)
 *   'cap'     -- a running total is at its ceiling, e.g. customers/staff (opts.limit)
 * opts.feature: key into the name tables above.
 */
function lockedResponse(res, business, opts) {
  const plan = getEffectivePlanSlug(business);
  const planName = PLAN_NAMES[plan] || 'current';
  const lapse = lapseInfo(business);
  const prefix = lapse ? lapse.text : '';
  const key = opts.feature;
  const limit = opts.limit;
  let kind = opts.kind;

  // An allowance of zero means "not part of this plan at all" -- say that plainly.
  if ((kind === 'quota' || kind === 'cap') && limit === 0) kind = 'feature';

  const featureName = FEATURE_NAMES[key] || 'This feature';
  const noun = NOUNS[key] || 'uses';
  const lapsedPaid = !!(lapse && lapse.reason === 'lapsed');
  const fixWord = lapsedPaid ? 'Renew' : 'Upgrade';

  let message;
  let reason;
  if (kind === 'feature') {
    message = prefix + featureName + " isn't included in your " + planName + ' plan. ' +
      (lapsedPaid ? 'Renew your plan to get it back.' : (lapse ? 'Upgrade to get it back.' : 'Upgrade to unlock it.'));
    reason = lapse ? lapse.reason : 'not_included';
  } else if (kind === 'quota') {
    message = prefix + "You've used all " + fmtNum(limit) + ' ' + noun + ' included in your ' + planName +
      ' plan this month. It resets on ' + nextMonthStart() + '. ' + fixWord + ' for a higher limit.';
    reason = 'quota';
  } else {
    message = prefix + "You've reached the " + fmtNum(limit) + ' ' + noun + ' your ' + planName +
      " plan includes. Your existing ones are safe. " + fixWord + ' to add more.';
    reason = 'cap';
  }

  return res.status(403).json({
    error: message,
    code: 'PLAN_LOCKED',
    locked: { kind: kind, feature: key, reason: reason, plan: plan, plan_name: planName },
  });
}

module.exports = { lockedResponse };