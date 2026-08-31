'use strict';

/**
 * roleGuard middleware factory
 * ───────────────────────────────────────────────────────────────────────────
 * Usage — pass one or more allowed roles:
 *
 *   router.get('/customers', auth, roleGuard('owner', 'staff'), handler);
 *   router.delete('/customers/:id', auth, roleGuard('owner'), handler);
 *   router.get('/admin/businesses', auth, roleGuard('super_admin'), handler);
 *
 * super_admin always passes any roleGuard — they have unrestricted access.
 * Must be used AFTER the auth middleware so req.user is populated.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * @param  {...string} allowedRoles - One or more role strings to permit.
 * @returns {Function} Express middleware
 */
const roleGuard = (...allowedRoles) => {
  if (allowedRoles.length === 0) {
    throw new Error('[roleGuard] At least one role must be specified');
  }

  return (req, res, next) => {
    if (!req.user) {
      // Should not happen — auth middleware must run first
      return res.status(401).json({ error: 'Unauthenticated. Use auth middleware before roleGuard.' });
    }

    const { role } = req.user;

    // super_admin bypasses all role restrictions
    if (role === 'super_admin') {
      return next();
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: `Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${role}`,
      });
    }

    return next();
  };
};

module.exports = roleGuard;
