'use strict';

/**
 * feedbackTagger.js
 * Free, deterministic keyword-based tagging for private feedback, so owners
 * can spot patterns without reading every entry. No external API needed --
 * swappable for a real LLM classifier later if ANTHROPIC_API_KEY is added.
 */

const TAG_RULES = [
  {
    tag: 'Staff',
    keywords: ['staff', 'employee', 'rude', 'unfriendly', 'attitude', 'manager',
      'receptionist', 'impolite', 'disrespect', 'behaviour', 'behavior'],
  },
  {
    tag: 'Wait Time',
    keywords: ['wait', 'waiting', 'slow', 'late', 'delay', 'delayed', 'queue',
      'long time', 'took forever', 'hours'],
  },
  {
    tag: 'Pricing',
    keywords: ['price', 'pricing', 'expensive', 'costly', 'overpriced', 'charge',
      'charged', 'bill', 'billing', 'refund', 'money'],
  },
  {
    tag: 'Cleanliness',
    keywords: ['dirty', 'clean', 'cleanliness', 'hygiene', 'hygienic', 'smell',
      'messy', 'mess', 'unclean', 'unhygienic'],
  },
  {
    tag: 'Quality',
    keywords: ['quality', 'poor', 'bad service', 'disappointed', 'disappointing',
      'unsatisfied', 'not good', 'worst', 'terrible', 'awful'],
  },
];

const generateTags = (feedbackText) => {
  if (!feedbackText || typeof feedbackText !== 'string') return [];
  const text = feedbackText.toLowerCase();
  const matched = [];

  for (const rule of TAG_RULES) {
    const hit = rule.keywords.some((kw) => text.includes(kw));
    if (hit) matched.push(rule.tag);
  }

  return matched;
};

module.exports = { generateTags, TAG_RULES };