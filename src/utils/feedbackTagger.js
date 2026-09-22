'use strict';

/**
 * feedbackTagger.js
 * Free, deterministic keyword-based tagging for private feedback, so owners
 * can spot patterns without reading every entry. No external API needed --
 * swappable for a real LLM classifier later if ANTHROPIC_API_KEY is added.
 *
 * GENERIC_TAG_RULES apply to every business. VERTICAL_TAG_RULES add
 * business-type-specific categories on top (e.g. a restaurant also gets
 * "Food Quality" in addition to the generic "Quality"). Unknown/unlisted
 * business types just fall back to the generic rules.
 */

const GENERIC_TAG_RULES = [
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

const VERTICAL_TAG_RULES = {
  salon: [
    { tag: 'Appointment', keywords: ['appointment', 'booking', 'rebook', 'reschedule', 'no-show', 'no show', 'cancelled'] },
    { tag: 'Stylist',     keywords: ['stylist', 'haircut', 'hair color', 'hair colour', 'coloring', 'colouring', 'style'] },
  ],
  barbershop: [
    { tag: 'Appointment', keywords: ['appointment', 'booking', 'rebook', 'reschedule', 'no-show', 'no show', 'cancelled'] },
    { tag: 'Barber',      keywords: ['barber', 'haircut', 'shave', 'trim'] },
  ],
  gym: [
    { tag: 'Equipment', keywords: ['equipment', 'machine', 'treadmill', 'weights', 'broken', 'out of order'] },
    { tag: 'Trainer',   keywords: ['trainer', 'instructor', 'coach', 'coaching'] },
  ],
  dental: [
    { tag: 'Appointment', keywords: ['appointment', 'waiting room', 'reschedule', 'no-show', 'no show'] },
    { tag: 'Treatment',   keywords: ['treatment', 'procedure', 'pain', 'painful', 'dentist'] },
  ],
  clinic: [
    { tag: 'Appointment', keywords: ['appointment', 'waiting room', 'reschedule', 'no-show', 'no show'] },
    { tag: 'Treatment',   keywords: ['treatment', 'doctor', 'diagnosis', 'consultation'] },
  ],
  restaurant: [
    { tag: 'Food Quality', keywords: ['food', 'taste', 'tasteless', 'cold food', 'undercooked', 'overcooked', 'stale'] },
    { tag: 'Reservation',  keywords: ['reservation', 'table', 'booking', 'seated'] },
  ],
  retail: [
    { tag: 'Product Quality', keywords: ['product', 'item', 'defective', 'damaged', 'broken', 'faulty'] },
    { tag: 'Delivery',        keywords: ['delivery', 'shipping', 'shipment', 'package', 'courier'] },
  ],
  auto: [
    { tag: 'Vehicle Service', keywords: ['car', 'vehicle', 'repair', 'mechanic', 'parts', 'service done'] },
    { tag: 'Timeliness',      keywords: ['pickup', 'pick up', 'drop off', 'ready on time', 'delay', 'delayed'] },
  ],
  real_estate: [
    { tag: 'Communication', keywords: ['agent', 'communication', 'follow up', 'followup', 'responsive', 'unresponsive'] },
    { tag: 'Paperwork',     keywords: ['paperwork', 'documentation', 'documents', 'process'] },
  ],
  education: [
    { tag: 'Teaching Quality', keywords: ['teacher', 'class', 'curriculum', 'lesson', 'course content'] },
    { tag: 'Communication',    keywords: ['communication', 'updates', 'informed', 'responsive'] },
  ],
  pet_care: [
    { tag: 'Pet Handling',  keywords: ['groomer', 'grooming', 'pet', 'dog', 'cat', 'handling'] },
    { tag: 'Communication', keywords: ['communication', 'updates', 'informed'] },
  ],
};

const generateTags = (feedbackText, businessType) => {
  if (!feedbackText || typeof feedbackText !== 'string') return [];
  const text = feedbackText.toLowerCase();
  const rules = GENERIC_TAG_RULES.concat(VERTICAL_TAG_RULES[businessType] || []);
  const matched = [];

  for (const rule of rules) {
    const hit = rule.keywords.some((kw) => text.includes(kw));
    if (hit && !matched.includes(rule.tag)) matched.push(rule.tag);
  }

  return matched;
};

module.exports = { generateTags, GENERIC_TAG_RULES, VERTICAL_TAG_RULES, TAG_RULES: GENERIC_TAG_RULES };