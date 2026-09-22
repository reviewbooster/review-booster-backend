'use strict';

const GOOGLE_OPENERS = [
  'Thank you so much for the wonderful review, {name}!',
  'We really appreciate you taking the time to share this, {name}!',
  'Thank you, {name} â€” this made our day!',
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
  "Thank you again for your support â€” see you next time!",
];

// -- Private feedback template banks -----------------------------------------
// Each bank is picked by the owner from four chips in the reply modal
// ("Apologize", "Thank Them", "Ask for Details", "Issue Resolved") -- purely
// static text with seeded variety, no external API.

const APOLOGIZE_OPENERS = [
  "Hi {name}, thank you for sharing your feedback with us.",
  "Hi {name}, we're sorry to hear your experience wasn't what you expected.",
  "Hi {name}, thank you for letting us know how we can do better.",
];
const APOLOGIZE_MIDDLES = [
  "We take feedback like this seriously and would love the chance to make things right.",
  "Your experience matters to us, and we'd really like to understand what happened.",
  "We'd appreciate the opportunity to address this directly with you.",
];
const APOLOGIZE_CLOSERS = [
  "Could we call you sometime today to talk it through? We're committed to making this right.",
  "Please let us know a good time to connect â€” we want to resolve this for you.",
  "We'd love to follow up personally. What's the best time to reach you?",
];

const THANK_OPENERS = [
  "Hi {name}, thank you so much for taking the time to share your feedback.",
  "Hi {name}, we really appreciate you letting us know how things went.",
  "Hi {name}, thanks for the honest feedback â€” it genuinely helps us.",
];
const THANK_MIDDLES = [
  "We're always working to improve, and hearing directly from customers like you makes a real difference.",
  "Feedback like this helps our whole team get better.",
  "We read every piece of feedback we get, and yours is no exception.",
];
const THANK_CLOSERS = [
  "Thanks again for taking the time.",
  "We appreciate you sharing this with us.",
  "Thank you for helping us improve.",
];

const ASK_OPENERS = [
  "Hi {name}, thank you for your feedback.",
  "Hi {name}, we'd like to understand this a little better.",
  "Hi {name}, thanks for letting us know something wasn't right.",
];
const ASK_MIDDLES = [
  "Could you share a few more details about what happened? It'll help us look into this properly.",
  "We'd appreciate a bit more detail so we can address this the right way.",
  "Would you mind telling us a little more about your experience?",
];
const ASK_CLOSERS = [
  "Looking forward to hearing more from you.",
  "Thanks in advance for the extra detail.",
  "We're here whenever you're ready to share more.",
];

const RESOLVED_OPENERS = [
  "Hi {name}, we wanted to follow up on your feedback.",
  "Hi {name}, just checking in on this.",
  "Hi {name}, following up on what you mentioned earlier.",
];
const RESOLVED_MIDDLES = [
  "We've looked into what you mentioned and taken steps to address it.",
  "We've addressed the issue you raised and wanted you to know.",
  "We've made a few changes based on what you told us.",
];
const RESOLVED_CLOSERS = [
  "We hope this resolves things â€” let us know if anything's still not right.",
  "Please let us know if there's anything else we can do.",
  "We appreciate your patience while we sorted this out.",
];

const TEMPLATE_BANKS = {
  apologize:      { openers: APOLOGIZE_OPENERS, middles: APOLOGIZE_MIDDLES, closers: APOLOGIZE_CLOSERS, includeContext: true },
  thank:          { openers: THANK_OPENERS,     middles: THANK_MIDDLES,     closers: THANK_CLOSERS,     includeContext: false },
  ask_details:    { openers: ASK_OPENERS,       middles: ASK_MIDDLES,       closers: ASK_CLOSERS,       includeContext: true },
  issue_resolved: { openers: RESOLVED_OPENERS,  middles: RESOLVED_MIDDLES,  closers: RESOLVED_CLOSERS,  includeContext: false },
};

const pick = (arr, seed) => arr[seed % arr.length];

const seedFrom = (id) => {
  const str = String(id || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
};

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');

const generateReply = ({ reviewId, rating, isPublic, customerName, businessName, feedbackText, template }) => {
  const seed = seedFrom(reviewId);
  const vars = { name: customerName || 'there', business: businessName || 'us' };

  if (isPublic) {
    const opener = fill(pick(GOOGLE_OPENERS, seed), vars);
    const middleBank = GOOGLE_MIDDLES[rating] || GOOGLE_MIDDLES[5];
    const middle = fill(pick(middleBank, seed + 1), vars);
    const closer = fill(pick(GOOGLE_CLOSERS, seed + 2), vars);
    return opener + ' ' + middle + ' ' + closer;
  }

  const bank = TEMPLATE_BANKS[template] || TEMPLATE_BANKS.apologize;
  const opener = fill(pick(bank.openers, seed), vars);
  const middle = fill(pick(bank.middles, seed + 1), vars);
  const closer = fill(pick(bank.closers, seed + 2), vars);
  const contextLine = (bank.includeContext && feedbackText)
    ? ' You mentioned: "' + feedbackText.slice(0, 120) + (feedbackText.length > 120 ? '...' : '') + '" â€” '
    : ' ';
  return opener + contextLine + middle + ' ' + closer;
};

module.exports = { generateReply };