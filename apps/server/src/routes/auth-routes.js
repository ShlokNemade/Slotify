import { Router } from 'express';
import { registerUser, loginUser, verifyEmail, revokeSession } from '../services/auth-service.js';
import { validate } from '../middleware/validate.js';
import { authenticate, SESSION_COOKIE_NAME } from '../middleware/auth.js';
import { registerUserSchema, loginUserSchema, verifyEmailSchema } from '@slotify/shared';
import { config } from '../config/index.js';

export const authRouter = Router();

/**
 * Helper to configure standard session cookie attributes.
 * @param {Date} expiresAt
 */
function getCookieOptions(expiresAt) {
  const isProd = config.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    expires: expiresAt,
    path: '/',
  };
}

/**
 * Register a new customer or business owner.
 */
authRouter.post('/register', validate({ body: registerUserSchema }), async (req, res, next) => {
  try {
    const result = await registerUser(req.body);
    const responseData = { user: result.user };

    // In non-production environments, expose the token in response to facilitate testing
    if (config.NODE_ENV !== 'production') {
      responseData.devVerificationToken = result.verificationToken;
    }

    res.status(201).json({
      success: true,
      data: responseData,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * User login.
 */
authRouter.post('/login', validate({ body: loginUserSchema }), async (req, res, next) => {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = req.ip || req.socket.remoteAddress || '';

    const { sessionToken, expiresAt, user } = await loginUser({
      ...req.body,
      userAgent,
      ipAddress,
    });

    res.cookie(SESSION_COOKIE_NAME, sessionToken, getCookieOptions(expiresAt));

    res.status(200).json({
      success: true,
      data: {
        user,
        sessionToken,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * User logout.
 */
authRouter.post('/logout', authenticate, async (req, res, next) => {
  try {
    if (req.rawSessionToken) {
      await revokeSession(req.rawSessionToken);
    }

    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get current session profile.
 */
authRouter.get('/me', authenticate, async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
      session: req.session,
    },
  });
});

/**
 * Verify user email address with single-use token.
 */
authRouter.post('/verify-email', validate({ body: verifyEmailSchema }), async (req, res, next) => {
  try {
    const result = await verifyEmail(req.body.token);
    res.status(200).json({
      success: true,
      message: 'Email successfully verified',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});
