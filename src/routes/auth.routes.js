'use strict';

/**
 * Auth routes
 *  -- 
 * POST /api/auth/signup          ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â public self-registration
 * POST /api/auth/register        ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â super_admin creates Business + User
 * POST /api/auth/login           ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â validates credentials, issues tokens
 * POST /api/auth/refresh         ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â rotates refresh token, new access token
 * POST /api/auth/logout          ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â clears refresh cookie
 * POST /api/auth/change-password ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â forced on first login
 *  -- 
 */

const express        = require('express');
const bcrypt         = require('bcryptjs');
const jwt            = require('jsonwebtoken');
const nodeCrypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Joi            = require('joi');
const rateLimit      = require('express-rate-limit');

const User     = require('../models/User');
const Business = require('../models/Business');
const BusinessReferral = require('../models/BusinessReferral');
const BusinessReferralSignup = require('../models/BusinessReferralSignup');
const PlatformBillingSettings = require('../models/PlatformBillingSettings');
const EmailOtp = require('../models/EmailOtp');
const auth     = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { asyncWrap } = require('../middleware/errorHandler');
const { sendPasswordResetEmail, sendNewSignupNotification, sendSignupOtpEmail } = require('../utils/mailer');

const router = express.Router();

//  -- 
// Constants
//  -- 

const BCRYPT_ROUNDS        = 12;
const ACCESS_TOKEN_TTL     = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_COOKIE_NAME  = 'refresh_token';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_S  = 30 * 24 * 60 * 60;

//  -- 
// Helpers
//  -- 

const sha256 = (value) =>
  nodeCrypto.createHash('sha256').update(value).digest('hex');

const signAccessToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');

  return jwt.sign(
    {
      id:          user._id.toString(),
      business_id: user.business_id ? user.business_id.toString() : null,
      role:        user.role,
      name:        user.name,
    },
    secret,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
};

const generateRefreshToken = () => nodeCrypto.randomBytes(48).toString('hex');

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge:   REFRESH_TOKEN_TTL_MS,
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
};

//  -- 
// Rate limiter ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 5 login attempts per 15 minutes per IP+email
// Applied only to POST /auth/login
//  -- 

const loginLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    5,
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: false,
  message: {
    error: 'Too many login attempts from this IP. Please try again in 15 minutes.',
  },
  keyGenerator: (req) => {
    const email = (req.body && req.body.email) ? req.body.email.toLowerCase().trim() : '';
    return `${req.ip}:${email}`;
  },
});

//  -- 
// Rate limiter ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 5 signup attempts per hour per IP
// Applied only to POST /auth/signup
//  -- 

const signupLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    error: 'Too many accounts created from this IP. Please try again later.',
  },
});

//  --
// Signup email verification -- a one-time code, checked only at signup.
// Per email address: 3 wrong tries locks that code for 15 minutes; a code
// is valid for 10 minutes; at most 1 new code every 60 seconds and 5 per
// hour. The IP-based limiter below is a looser second layer on top of that.
//  --
const OTP_LENGTH               = 6;
const OTP_EXPIRY_MINUTES       = 10;
const OTP_MAX_ATTEMPTS         = 3;
const OTP_LOCK_MINUTES         = 15;
const OTP_RESEND_COOLDOWN_SECS = 60;
const OTP_MAX_PER_HOUR         = 5;

const otpRequestLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    error: 'Too many verification codes requested from this network. Please try again later.',
  },
});

const otpRequestSchema = Joi.object({
  email: Joi.string().email().required(),
});

//  -- 
// Joi validation schemas
//  -- 

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(1).required(),
});

const BUSINESS_TYPES = ['salon', 'barbershop', 'gym', 'dental', 'clinic', 'restaurant', 'retail', 'auto', 'real_estate', 'education', 'pet_care', 'other'];

const registerSchema = Joi.object({
  business_name:       Joi.string().min(2).max(100).required(),
  business_type:       Joi.string().valid(...BUSINESS_TYPES).required(),
  business_type_other: Joi.string().min(2).max(50).when('business_type', {
    is: 'other', then: Joi.required(), otherwise: Joi.optional().allow('', null),
  }),
  google_review_url: Joi.string().uri().required(),
  owner_name:        Joi.string().min(2).max(100).required(),
  owner_email:       Joi.string().email().required(),
  owner_password:    Joi.string().min(8).required(),
  role:              Joi.string().valid('owner', 'staff').default('owner'),
});

const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password:     Joi.string().min(8).required(),
});

const signupSchema = Joi.object({
  business_name:       Joi.string().min(2).max(100).required(),
  business_type:       Joi.string().valid(...BUSINESS_TYPES).required(),
  business_type_other: Joi.string().min(2).max(50).when('business_type', {
    is: 'other', then: Joi.required(), otherwise: Joi.optional().allow('', null),
  }),
  owner_name:        Joi.string().min(2).max(100).required(),
  email:             Joi.string().email().required(),
  phone:             Joi.string().pattern(/^[6-9]\d{9}$/).required()
                       .messages({ 'string.pattern.base': 'Enter a valid 10-digit mobile number.' }),
  password:          Joi.string().min(8).required(),
  confirm_password:  Joi.string().valid(Joi.ref('password')).required()
                       .messages({ 'any.only': 'Passwords do not match.' }),
  google_review_url: Joi.string().uri().optional().allow('', null),
  ref:                Joi.string().trim().max(20).optional().allow('', null),
  otp_code:          Joi.string().length(6).pattern(/^\d+$/).required()
                       .messages({ 'string.pattern.base': 'Enter the 6-digit code we emailed you.' }),
});

//  -- 
// POST /auth/register
//  -- 
/**
 * Super-admin only. Creates a new Business + owner User in one operation.
 * google_review_url is required here ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â admin always sets it at registration.
 */
router.post(
  '/register',
  auth,
  roleGuard('super_admin'),
  asyncWrap(async (req, res) => {
    const { error, value } = registerSchema.validate(req.body, {
      abortEarly:   true,
      stripUnknown: true,
    });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const {
      business_name, business_type, business_type_other, google_review_url,
      owner_name, owner_email, owner_password, role,
    } = value;

    const existingUser = await User.findOne({ email: owner_email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }

    const password_hash = await bcrypt.hash(owner_password, BCRYPT_ROUNDS);

    const billingCfg = await PlatformBillingSettings.findOne({}).select('trial_days').lean();
    const trialDays = (billingCfg && billingCfg.trial_days) || 14;

    const business = await Business.create({
      name:              business_name,
      type:              business_type,
      type_other:        business_type === 'other' ? business_type_other : null,
      google_review_url,
      plan:              'free',
      trial_ends_at:     new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
      source:            'admin_created',
    });

    const user = await User.create({
      business_id:          business._id,
      name:                 owner_name,
      email:                owner_email.toLowerCase().trim(),
      password_hash,
      role,
      must_change_password: true,
    });

    return res.status(201).json({
      message:  'Business and user created successfully.',
      business: { id: business._id, name: business.name, plan: business.plan },
      user: {
        id:                   user._id,
        name:                 user.name,
        email:                user.email,
        role:                 user.role,
        must_change_password: user.must_change_password,
      },
    });
  })
);

//  --
// POST /auth/signup/request-otp
//  --
/**
 * Sends (or resends) a 6-digit email verification code. Doesn't create
 * anything yet -- just proves the email address is real and reachable
 * before the account exists.
 */
router.post(
  '/signup/request-otp',
  otpRequestLimiter,
  asyncWrap(async (req, res) => {
    const { error, value } = otpRequestSchema.validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const email = value.email.toLowerCase().trim();

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recentCount, mostRecent] = await Promise.all([
      EmailOtp.countDocuments({ email, created_at: { $gte: hourAgo } }),
      EmailOtp.findOne({ email }).sort({ created_at: -1 }).lean(),
    ]);

    if (recentCount >= OTP_MAX_PER_HOUR) {
      return res.status(429).json({ error: 'Too many codes requested for this email. Please try again in an hour.' });
    }
    if (mostRecent && Date.now() - new Date(mostRecent.created_at).getTime() < OTP_RESEND_COOLDOWN_SECS * 1000) {
      return res.status(429).json({ error: 'Please wait a moment before requesting another code.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)).slice(0, OTP_LENGTH);
    const otpRecord = await EmailOtp.create({ email, code_hash: sha256(code) });

    // The Gmail SMTP connection from Render's free tier is occasionally
    // slow to establish -- one retry after a short pause clears most
    // transient timeouts. If it still fails, don't leave an orphaned code
    // counting against the hourly limit, and say so plainly instead of
    // falling through to a generic error.
    try {
      try {
        await sendSignupOtpEmail(email, code);
      } catch (firstErr) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await sendSignupOtpEmail(email, code);
      }
    } catch (sendErr) {
      await EmailOtp.deleteOne({ _id: otpRecord._id });
      console.error('[signup/request-otp] Email send failed twice:', sendErr.message);
      return res.status(502).json({ error: 'We could not send the verification email right now. Please try again in a moment.' });
    }

    res.json({ data: { sent: true } });
  })
);

//  -- 
// POST /auth/signup
//  -- 
/**
 * Public self-registration. Creates Business + owner User, after checking
 * the emailed verification code. Rate-limited to 5 signups per hour per IP.
 * Sets must_change_password: false -- user chose their own password.
 * google_review_url is optional -- can be added later in Settings.
 */
router.post(
  '/signup',
  signupLimiter,
  asyncWrap(async (req, res) => {
    const { error, value } = signupSchema.validate(req.body, {
      abortEarly:   true,
      stripUnknown: true,
    });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { business_name, business_type, business_type_other, owner_name, email, phone, password, google_review_url, ref, otp_code } = value;

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    // Verify the emailed code before creating anything.
    const otpRecord = await EmailOtp.findOne({ email: email.toLowerCase().trim(), verified: false }).sort({ created_at: -1 });
    if (!otpRecord) {
      return res.status(400).json({ error: 'Enter the verification code we emailed you, or request a new one.' });
    }
    if (otpRecord.locked_until && new Date(otpRecord.locked_until) > new Date()) {
      const minsLeft = Math.ceil((new Date(otpRecord.locked_until).getTime() - Date.now()) / 60000);
      return res.status(429).json({ error: 'Too many incorrect attempts. Try again in ' + minsLeft + ' minute' + (minsLeft === 1 ? '' : 's') + '.' });
    }
    const codeAge = Date.now() - new Date(otpRecord.created_at).getTime();
    if (codeAge > OTP_EXPIRY_MINUTES * 60 * 1000) {
      return res.status(400).json({ error: 'This code has expired. Request a new one.' });
    }
    if (otpRecord.code_hash !== sha256(otp_code)) {
      otpRecord.attempts += 1;
      if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
        otpRecord.locked_until = new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000);
        await otpRecord.save();
        return res.status(429).json({ error: 'Too many incorrect attempts. Try again in ' + OTP_LOCK_MINUTES + ' minutes.' });
      }
      await otpRecord.save();
      const left = OTP_MAX_ATTEMPTS - otpRecord.attempts;
      return res.status(400).json({ error: 'Incorrect code. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' });
    }
    otpRecord.verified = true;
    await otpRecord.save();

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Engine B ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â resolve an incoming ?ref= code (if any) to the referring
    // business before creating this one, so it can be tagged at creation.
    let referringBusinessReferral = null;
    if (ref && ref.trim()) {
      referringBusinessReferral = await BusinessReferral.findOne({ code: ref.trim().toUpperCase() });
    }

    const billingCfg = await PlatformBillingSettings.findOne({}).select('trial_days').lean();
    const trialDays = (billingCfg && billingCfg.trial_days) || 14;

    const business = await Business.create({
      name:              business_name,
      type:              business_type,
      type_other:        business_type === 'other' ? business_type_other : null,
      google_review_url: google_review_url || null,
      phone:             phone || null,
      plan:              'free',
      trial_ends_at:     new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
      referred_by_business_id: referringBusinessReferral ? referringBusinessReferral.business_id : null,
      source: 'self_signup',
    });

    if (referringBusinessReferral) {
      await BusinessReferralSignup.create({
        referral_id:           referringBusinessReferral._id,
        referrer_business_id:  referringBusinessReferral.business_id,
        new_business_id:       business._id,
      }).catch(() => { /* duplicate-key race on the unique new_business_id ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â safe to ignore */ });
    }


    const user = await User.create({
      business_id:          business._id,
      name:                 owner_name,
      email:                email.toLowerCase().trim(),
      password_hash,
      role:                 'owner',
      must_change_password: false,
    });

    sendNewSignupNotification(owner_name, business.name, business.type, email).catch(function() { /* non-critical -- never block signup on this */ });

    const accessToken     = signAccessToken(user);
    const rawRefreshToken = generateRefreshToken();
    await User.updateOne(
      { _id: user._id },
      { refresh_token_hash: sha256(rawRefreshToken) }
    );
    setRefreshCookie(res, rawRefreshToken);

    return res.status(201).json({
      token: accessToken,
      user: {
        id:          user._id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        business_id: user.business_id,
        must_change_password: false,
        onboarding_completed: false,
      },
    });
  })
);

//  -- 
// POST /auth/login
//  -- 

router.post(
  '/login',
  loginLimiter,
  asyncWrap(async (req, res) => {
    const { error, value } = loginSchema.validate(req.body, {
      abortEarly:   true,
      stripUnknown: true,
    });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { email, password } = value;

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    const dummyHash    = '$2a$12$invalidhashfortimingconsistency000000000000000000000000';
    const hashToCompare = user ? user.password_hash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    let onboardingCompleted = true;
    if (user.business_id) {
      const business = await Business.findById(user.business_id).select('is_suspended onboarding_completed').lean();
      if (business && business.is_suspended) {
        return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
      }
      onboardingCompleted = business ? !!business.onboarding_completed : true;
    }

    const accessToken    = signAccessToken(user);
    const rawRefreshToken = generateRefreshToken();
    await User.updateOne(
      { _id: user._id },
      { refresh_token_hash: sha256(rawRefreshToken) }
    );
    setRefreshCookie(res, rawRefreshToken);

    return res.status(200).json({
      token:                accessToken,
      must_change_password: user.must_change_password,
      user: {
        id:          user._id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        business_id: user.business_id,
        onboarding_completed: onboardingCompleted,
      },
    });
  })
);

//  -- 
// POST /auth/refresh
//  -- 

router.post(
  '/refresh',
  asyncWrap(async (req, res) => {
    const rawRefreshToken = req.cookies[REFRESH_COOKIE_NAME];

    if (!rawRefreshToken) {
      return res.status(401).json({ error: 'No refresh token provided.', code: 'NO_REFRESH_TOKEN' });
    }

    const tokenHash = sha256(rawRefreshToken);
    const user      = await User.findOne({ refresh_token_hash: tokenHash });

    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid or expired refresh token. Please log in again.' });
    }

    let onboardingCompleted = true;
    if (user.business_id) {
      const business = await Business.findById(user.business_id).select('is_suspended onboarding_completed').lean();
      if (business && business.is_suspended) {
        clearRefreshCookie(res);
        return res.status(403).json({ error: 'Account suspended.' });
      }
      onboardingCompleted = business ? !!business.onboarding_completed : true;
    }

    const newAccessToken    = signAccessToken(user);
    const newRawRefreshToken = generateRefreshToken();
    await User.updateOne(
      { _id: user._id },
      { refresh_token_hash: sha256(newRawRefreshToken) }
    );
    setRefreshCookie(res, newRawRefreshToken);

    return res.status(200).json({
      token: newAccessToken,
      user: {
        id:                   user._id,
        name:                 user.name,
        email:                user.email,
        role:                 user.role,
        business_id:          user.business_id,
        must_change_password: user.must_change_password,
        onboarding_completed: onboardingCompleted,
      },
    });
  })
);

//  -- 
// POST /auth/logout
//  -- 

router.post(
  '/logout',
  auth,
  asyncWrap(async (req, res) => {
    await User.updateOne(
      { _id: req.user.id },
      { refresh_token_hash: null }
    );
    clearRefreshCookie(res);
    return res.status(200).json({ message: 'Logged out successfully.' });
  })
);

//  -- 
// POST /auth/change-password
//  -- 

router.post(
  '/change-password',
  auth,
  asyncWrap(async (req, res) => {
    const { error, value } = changePasswordSchema.validate(req.body, {
      abortEarly:   true,
      stripUnknown: true,
    });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { current_password, new_password } = value;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const passwordMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password must be different from the current password.' });
    }

    const newHash           = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    const newRawRefreshToken = generateRefreshToken();

    await User.updateOne(
      { _id: user._id },
      {
        password_hash:        newHash,
        must_change_password: false,
        refresh_token_hash:   sha256(newRawRefreshToken),
      }
    );

    user.must_change_password = false;
    const newAccessToken = signAccessToken(user);
    setRefreshCookie(res, newRawRefreshToken);

    return res.status(200).json({
      message: 'Password changed successfully.',
      token:   newAccessToken,
    });
  })
);

//  -- 
// POST /auth/forgot-password
//  -- 

router.post(
  '/forgot-password',
  asyncWrap(async (req, res) => {
    const { error, value } = Joi.object({
      email: Joi.string().email().required(),
    }).validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await User.findOne({ email: value.email.toLowerCase().trim() });

    if (!user) {
      return res.status(200).json({ message: 'If that email exists, a reset link has been sent to it.' });
    }

    if (user.role === 'super_admin') {
      const rawToken  = nodeCrypto.randomBytes(32).toString('hex');
      const tokenHash = sha256(rawToken);
      const expires   = new Date(Date.now() + 60 * 60 * 1000);

      await User.updateOne(
        { _id: user._id },
        { reset_token_hash: tokenHash, reset_token_expires: expires }
      );

      const resetLink = process.env.FRONTEND_URL + '/reset-password?token=' + rawToken;

      try {
        await sendPasswordResetEmail(user.email, resetLink);
      } catch (mailErr) {
        console.error('[FORGOT PASSWORD] Email send failed:', mailErr.message);
        return res.status(500).json({ error: 'Failed to send reset email. Check SMTP configuration.' });
      }

      return res.status(200).json({ message: 'A password reset link has been sent to your email. It expires in 1 hour.' });
    }

    await User.updateOne({ _id: user._id }, { password_reset_requested: true });
    console.log('[FORGOT PASSWORD] Reset requested for:', user.email);

    return res.status(200).json({ message: 'Your request has been sent to the administrator.' });
  })
);

//  -- 
// POST /auth/reset-password
//  -- 

router.post(
  '/reset-password',
  asyncWrap(async (req, res) => {
    const { error, value } = Joi.object({
      token:        Joi.string().required(),
      new_password: Joi.string().min(8).required(),
    }).validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { token, new_password } = value;
    const tokenHash = sha256(token);

    const user = await User.findOne({
      reset_token_hash:    tokenHash,
      reset_token_expires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

    await User.updateOne(
      { _id: user._id },
      {
        password_hash:        newHash,
        must_change_password: false,
        reset_token_hash:     null,
        reset_token_expires:  null,
      }
    );

    return res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  })
);

module.exports = router;