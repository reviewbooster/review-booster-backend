'use strict';

const GOOGLE_OPENERS = [
  'Thank you so much for the wonderful review, {name}!',
  'We really appreciate you taking the time to share this, {name}!',
  'Thank you, {name} — this made our day!',
];

const GOOGLE_MIDDLES = {
  5: [
    "We're thrilled you had such a great experience with us.",
    "It means a lot to know we hit the mark for you.",
    "Reviews like this remind our whole team why we do what we do.",
  ],
  4: [
    "We're glad you had a positive experience with us.",
    "It's great to hear you enjoyed your time with {business}.",
  ],
};

const GOOGLE_CLOSERS = [
  "We look forward to welcoming you back soon!",
  "Hope to see you again at {business} very soon!",
  "Thank you again for your support — see you next time!",
];

const PRIVATE_OPENERS = [
  "Hi {name}, thank you for sharing your feedback with us.",
  "Hi {name}, we're sorry to hear your experience wasn't what you expected.",
  "Hi {name}, thank you for letting us know how we can do better.",
];

const PRIVATE_MIDDLES = [
  "We take feedback like this seriously and would love the chance to make things right.",
  "Your experience matters to us, and we'd really like to understand what happened.",
  "We'd appreciate the opportunity to address this directly with you.",
];

const PRIVATE_CLOSERS = [
  "Could we call you sometime today to talk it through? We're committed to making this right.",
  "Please let us know a good time to connect — we want to resolve this for you.",
  "We'd love to follow up personally. What's the best time to reach you?",
];

const pick = (arr, seed) => arr[seed % arr.length];

const seedFrom = (id) => {
  const str = String(id || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
};

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');

const generateReply = ({ reviewId, rating, isPublic, customerName, businessName, feedbackText }) => {
  const seed = seedFrom(reviewId);
  const vars = { name: customerName || 'there', business: businessName || 'us' };

  if (isPublic) {
    const opener = fill(pick(GOOGLE_OPENERS, seed), vars);
    const middleBank = GOOGLE_MIDDLES[rating] || GOOGLE_MIDDLES[5];
    const middle = fill(pick(middleBank, seed + 1), vars);
    const closer = fill(pick(GOOGLE_CLOSERS, seed + 2), vars);
    return opener + ' ' + middle + ' ' + closer;
  }

  const opener = fill(pick(PRIVATE_OPENERS, seed), vars);
  const middle = fill(pick(PRIVATE_MIDDLES, seed + 1), vars);
  const closer = fill(pick(PRIVATE_CLOSERS, seed + 2), vars);
  const contextLine = feedbackText
    ? ' You mentioned: "' + feedbackText.slice(0, 120) + (feedbackText.length > 120 ? '...' : '') + '" — '
    : ' ';
  return opener + contextLine + middle + ' ' + closer;
};

module.exports = { generateReply };