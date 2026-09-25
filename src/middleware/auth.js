'use strict';

const jwt      = require('jsonwebtoken');
const Business = require('../models/Business');

/**
 * auth middleware
 * Verifies Bearer JWT. For business users (non-super_admin), also checks
 * is_suspended on the Business document -- returns 403 if suspended.
 */
const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header missing' });
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ error: 'Authorization header format must be: Bearer <token>' });
    }

    const token = parts[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token missing' });
    }

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error('[auth] JWT_SECRET environment variable is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, secret);

    req.user = {
      id:          decoded.id,
      business_id: decoded.business_id ?? null,
      role:        decoded.role,
      name:        decoded.name,
    };

    // Suspension check -- only for business users, not super_admin
    if (req.user.business_id) {
      const business = await Business.findById(req.user.business_id)
        .select('is_suspended')
        .lean();
      if (business && business.is_suspended) {
        return res.status(403).json({ error: 'Account suspended.' });
      }
    }

    return next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    console.error('[auth] JWT verification error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

module.exports = auth;