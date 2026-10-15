import { validateSession } from '../services/auth-service.js';
import { UnauthorizedError, ForbiddenError } from '../errors/index.js';

export const SESSION_COOKIE_NAME = 'slotify_session';

/**
 * Middleware to authenticate requests using cookie-based or header-based session tokens.
 */
export async function authenticate(req, _res, next) {
  try {
    const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const token = cookieToken || bearerToken;
    if (!token) {
      throw new UnauthorizedError('Authentication session required');
    }

    const sessionData = await validateSession(token);
    if (!sessionData) {
      throw new UnauthorizedError('Invalid or expired session');
    }

    req.user = sessionData.user;
    req.session = sessionData.session;
    req.rawSessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware guard to require specific user roles.
 * @param  {...string} roles
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }
    next();
  };
}

/**
 * Middleware guard to require a verified email address (e.g. before booking).
 */
export function requireVerifiedEmail(req, _res, next) {
  if (!req.user) {
    return next(new UnauthorizedError());
  }
  if (!req.user.isEmailVerified) {
    return next(new ForbiddenError('Email verification required before accessing this resource'));
  }
  next();
}
