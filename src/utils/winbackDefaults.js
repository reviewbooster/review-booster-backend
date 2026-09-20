'use strict';
/**
 * src/utils/winbackDefaults.js
 * Business-type-aware starting point for a new business's win-back settings.
 * Only used the moment a WinBackSettings doc is first created for a business
 * (see winback.controller.js getOrDefaultSettings) -- the instant an owner
 * saves their own values, these are never consulted again for that business.
 */

var DEFAULTS = {
  salon:       { inactive_days: 35,  message_text: "Hi {name}, it's been a while since your last visit! Book your next appointment this week and get 15% off.", offer_text: '15% off your next visit' },
  barbershop:  { inactive_days: 28,  message_text: "Hi {name}, time for a fresh cut! Come by this week and we'll have you sorted.", offer_text: '10% off your next cut' },
  gym:         { inactive_days: 18,  message_text: "Hi {name}, we miss you at the gym! Come back this week -- bring a friend along for free.", offer_text: 'Bring a friend free this week' },
  dental:      { inactive_days: 150, message_text: "Hi {name}, it's about time for your next dental checkup. Book your appointment to keep your smile healthy!", offer_text: '' },
  clinic:      { inactive_days: 150, message_text: "Hi {name}, it's been a while since your last visit. Book a checkup with us whenever you're ready.", offer_text: '' },
  restaurant:  { inactive_days: 25,  message_text: "Hi {name}, we haven't seen you in a while! Come back this week for 20% off your order.", offer_text: '20% off your next order' },
  retail:      { inactive_days: 40,  message_text: "Hi {name}, we've got new arrivals since your last visit! Come check them out.", offer_text: '10% off your next purchase' },
  auto:        { inactive_days: 100, message_text: "Hi {name}, your vehicle's next service may be due. Book your appointment with us today.", offer_text: 'Free vehicle inspection with your service' },
  real_estate: { inactive_days: 60,  message_text: "Hi {name}, just checking in! Let us know if you're still looking or have any questions.", offer_text: '' },
  education:   { inactive_days: 21,  message_text: "Hi {name}, we miss you in class! Come back and continue your progress with us.", offer_text: '10% off your next month' },
  pet_care:    { inactive_days: 35,  message_text: "Hi {name}, it's about time for your pet's next grooming session! Book this week.", offer_text: '15% off your next grooming' },
};

var FALLBACK = { inactive_days: 30, message_text: "Hi {name}, it's been a while since we've seen you! We'd love to have you back.", offer_text: '' };

function getWinBackDefaults(businessType) {
  return DEFAULTS[businessType] || FALLBACK;
}

module.exports = { getWinBackDefaults };
