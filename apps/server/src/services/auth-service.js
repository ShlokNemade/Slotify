import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { config } from '../config/index.js';
import { UserRole, AccountStatus, OutboxEventType, OutboxStatus } from '@slotify/shared';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
} from '../errors/index.js';

const BCRYPT_ROUNDS = 12;

/**
 * Hash raw token into SHA-256 hex string for safe database storage.
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Register a new customer or business owner.
 * @param {{ email: string, password: string, fullName: string, role: string }} data
 * @returns {Promise<{ user: Record<string, unknown>, verificationToken: string }>}
 */
export async function registerUser({ email, password, fullName, role = UserRole.CUSTOMER }) {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db.collection('users').findOne({ email: normalizedEmail });
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const rawVerificationToken = randomBytes(32).toString('hex');
  const verificationTokenHash = hashToken(rawVerificationToken);
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const now = new Date();
  const newUser = {
    email: normalizedEmail,
    fullName,
    passwordHash,
    role,
    accountStatus: AccountStatus.PENDING_VERIFICATION,
    isEmailVerified: false,
    verificationTokenHash,
    verificationExpiresAt,
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await db.collection('users').insertOne(newUser);
  const userId = insertResult.insertedId;

  // Insert outbox event for sending verification email asynchronously
  await db.collection('outbox').insertOne({
    aggregateId: userId,
    aggregateType: 'user',
    eventType: OutboxEventType.USER_VERIFICATION_REQUESTED,
    payload: {
      userId: userId.toString(),
      email: normalizedEmail,
      fullName,
      verificationToken: rawVerificationToken,
    },
    status: OutboxStatus.PENDING,
    attempts: 0,
    createdAt: now,
  });

  return {
    user: {
      id: userId.toString(),
      email: normalizedEmail,
      fullName,
      role,
      accountStatus: newUser.accountStatus,
      isEmailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
    verificationToken: rawVerificationToken,
  };
}

/**
 * Authenticate user credentials and establish a secure session.
 * @param {{ email: string, password: string, userAgent?: string, ipAddress?: string }} data
 * @returns {Promise<{ sessionToken: string, user: Record<string, unknown>, expiresAt: Date }>}
 */
export async function loginUser({ email, password, userAgent = '', ipAddress = '' }) {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const user = await db.collection('users').findOne({ email: normalizedEmail });
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.accountStatus === AccountStatus.SUSPENDED) {
    throw new ForbiddenError('Account is suspended. Please contact platform support.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Create session
  const rawSessionToken = randomBytes(32).toString('hex');
  const sessionTokenHash = hashToken(rawSessionToken);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);
  const now = new Date();

  await db.collection('sessions').insertOne({
    userId: user._id,
    sessionTokenHash,
    role: user.role,
    userAgent,
    ipAddress,
    createdAt: now,
    expiresAt,
    revokedAt: null,
  });

  return {
    sessionToken: rawSessionToken,
    expiresAt,
    user: {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      accountStatus: user.accountStatus,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

/**
 * Request a password reset. The response is intentionally non-enumerating:
 * unknown emails, suspended accounts, and valid requests all return the same shape.
 * @param {{ email: string }} data
 * @returns {Promise<{ sent: boolean, resetToken?: string }>}
 */
export async function requestPasswordReset({ email }) {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const user = await db.collection('users').findOne({ email: normalizedEmail });

  // Non-enumerating: silently no-op when the account does not exist or is suspended.
  if (!user || user.accountStatus === AccountStatus.SUSPENDED) {
    return { sent: true };
  }

  const rawResetToken = randomBytes(32).toString('hex');
  const resetTokenHash = hashToken(rawResetToken);
  const resetExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const now = new Date();

  await db.collection('users').updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: resetTokenHash,
        passwordResetExpiresAt: resetExpiresAt,
        updatedAt: now,
      },
    }
  );

  await db.collection('outbox').insertOne({
    aggregateId: user._id,
    aggregateType: 'user',
    eventType: OutboxEventType.PASSWORD_RESET_REQUESTED,
    payload: {
      userId: user._id.toString(),
      email: normalizedEmail,
      fullName: user.fullName,
      resetToken: rawResetToken,
    },
    status: OutboxStatus.PENDING,
    attempts: 0,
    createdAt: now,
  });

  return { sent: true, resetToken: rawResetToken };
}

/**
 * Complete a password reset using a single-use token.
 * Revokes every active session for the user (sensitive account change).
 * @param {{ token: string, newPassword: string }} data
 * @returns {Promise<{ reset: boolean }>}
 */
export async function completePasswordReset({ token, newPassword }) {
  const db = getDb();
  const tokenHash = hashToken(token);
  const now = new Date();

  const user = await db.collection('users').findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: now },
  });

  if (!user) {
    throw new ValidationError('Reset token is invalid or has expired');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await db.collection('users').updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash,
        updatedAt: now,
      },
      $unset: {
        passwordResetTokenHash: '',
        passwordResetExpiresAt: '',
      },
    }
  );

  // Security requirement: invalidate sessions after sensitive account changes.
  await revokeAllUserSessions(user._id.toString());

  return { reset: true };
}

/**
 * Verify a user's email address using their single-use token.
 * @param {string} token
 * @returns {Promise<{ verified: boolean, email: string }>}
 */
export async function verifyEmail(token) {
  const db = getDb();
  const tokenHash = hashToken(token);
  const now = new Date();

  const user = await db.collection('users').findOne({
    verificationTokenHash: tokenHash,
    verificationExpiresAt: { $gt: now },
  });

  if (!user) {
    throw new ValidationError('Verification token is invalid or has expired');
  }

  await db.collection('users').updateOne(
    { _id: user._id },
    {
      $set: {
        isEmailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        updatedAt: now,
      },
      $unset: {
        verificationTokenHash: '',
        verificationExpiresAt: '',
      },
    }
  );

  return {
    verified: true,
    email: user.email,
  };
}

/**
 * Validate session token and return the associated user and session record.
 * @param {string} sessionToken
 * @returns {Promise<{ user: Record<string, unknown>, session: Record<string, unknown> } | null>}
 */
export async function validateSession(sessionToken) {
  const db = getDb();
  const tokenHash = hashToken(sessionToken);
  const now = new Date();

  const session = await db.collection('sessions').findOne({
    sessionTokenHash: tokenHash,
    revokedAt: null,
    expiresAt: { $gt: now },
  });

  if (!session) {
    return null;
  }

  const user = await db.collection('users').findOne({
    _id: session.userId,
    accountStatus: { $ne: AccountStatus.SUSPENDED },
  });

  if (!user) {
    return null;
  }

  return {
    session: {
      id: session._id.toString(),
      userId: session.userId.toString(),
      role: session.role,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    },
    user: {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      accountStatus: user.accountStatus,
      isEmailVerified: user.isEmailVerified,
    },
  };
}

/**
 * Revoke an active session (logout).
 * @param {string} sessionToken
 */
export async function revokeSession(sessionToken) {
  const db = getDb();
  const tokenHash = hashToken(sessionToken);
  await db
    .collection('sessions')
    .updateOne({ sessionTokenHash: tokenHash }, { $set: { revokedAt: new Date() } });
}

/**
 * Revoke all sessions for a user (used after password reset or role change).
 * @param {string} userId
 */
export async function revokeAllUserSessions(userId) {
  const db = getDb();
  await db
    .collection('sessions')
    .updateMany({ userId: new ObjectId(userId) }, { $set: { revokedAt: new Date() } });
}
