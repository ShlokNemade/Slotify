import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/mongo.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import {
  BusinessStatus,
  OutboxEventType,
  OutboxStatus,
  UserRole,
  AuditScope,
} from '@slotify/shared';

const BCRYPT_ROUNDS = 12;

/**
 * Idempotently bootstrap (or reset the password of) a platform admin.
 * Only intended for local/ops use via the bootstrap script — never exposed
 * through public registration.
 * @param {{ email: string, password: string }} params
 * @returns {Promise<{ created: boolean, adminId: string }>}
 */
export async function bootstrapAdmin({ email, password }) {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = new Date();

  const existing = await db.collection('users').findOne({ email: normalizedEmail });

  if (!existing) {
    const insertResult = await db.collection('users').insertOne({
      email: normalizedEmail,
      fullName: 'Platform Admin',
      passwordHash,
      role: UserRole.PLATFORM_ADMIN,
      accountStatus: 'active',
      isEmailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return { created: true, adminId: insertResult.insertedId.toString() };
  }

  // Existing account: elevate to platform admin and reset the password.
  // Idempotent re-run must not fail; role/password converge to env values.
  await db.collection('users').updateOne(
    { _id: existing._id },
    {
      $set: {
        role: UserRole.PLATFORM_ADMIN,
        accountStatus: 'active',
        isEmailVerified: true,
        passwordHash,
        updatedAt: now,
      },
    }
  );
  return { created: false, adminId: existing._id.toString() };
}

/**
 * List businesses filtered by approval status (platform admin view).
 * @param {{ status?: string, page?: number, limit?: number }} query
 * @returns {Promise<{ businesses: Array<Record<string, unknown>>, total: number, page: number, limit: number }>}
 */
export async function listBusinessesByStatus({ status, page = 1, limit = 20 }) {
  const db = getDb();
  const filter = {};
  if (status) {
    if (!Object.values(BusinessStatus).includes(status)) {
      throw new ValidationError('Unknown business status filter');
    }
    filter.status = status;
  }

  const total = await db.collection('businesses').countDocuments(filter);
  const docs = await db
    .collection('businesses')
    .find(filter)
    .sort({ createdAt: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return {
    businesses: docs.map((doc) => ({
      id: doc._id.toString(),
      name: doc.name,
      slug: doc.slug,
      category: doc.category,
      status: doc.status,
      ownerId: doc.ownerId.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      reviewNotes: doc.reviewNotes ?? null,
      reviewedAt: doc.reviewedAt ?? null,
    })),
    total,
    page,
    limit,
  };
}

/**
 * Approve or reject a business (platform admin review decision).
 * Writes an append-only audit event and an outbox event for owner notification.
 * @param {string} adminId
 * @param {string} businessId
 * @param {{ status: string, notes: string }} decision Zod-validated payload
 * @returns {Promise<Record<string, unknown>>} updated business
 */
export async function reviewBusiness(adminId, businessId, { status, notes }) {
  const db = getDb();
  let parsedId;
  try {
    parsedId = new ObjectId(businessId);
  } catch {
    throw new NotFoundError('Invalid business identifier');
  }

  const business = await db.collection('businesses').findOne({ _id: parsedId });
  if (!business) {
    throw new NotFoundError('Business not found');
  }

  const now = new Date();
  const updated = await db
    .collection('businesses')
    .findOneAndUpdate(
      { _id: parsedId },
      {
        $set: {
          status,
          reviewNotes: notes,
          reviewedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

  if (!updated) {
    throw new NotFoundError('Business not found');
  }

  // Append-only audit record (platform scope, admin actor)
  await db.collection('audit_events').insertOne({
    actorId: new ObjectId(adminId),
    actorRole: UserRole.PLATFORM_ADMIN,
    action: `business.${status}`,
    scope: AuditScope.PLATFORM,
    businessId: parsedId,
    targetId: parsedId,
    targetType: 'business',
    metadata: {
      previousStatus: business.status,
      newStatus: status,
      notes,
    },
    timestamp: now,
  });

  // Outbox event so owner notification stays asynchronous (Phase 5 workers)
  await db.collection('outbox').insertOne({
    aggregateId: parsedId,
    aggregateType: 'business',
    eventType:
      status === BusinessStatus.APPROVED
        ? OutboxEventType.BUSINESS_APPROVED
        : OutboxEventType.BUSINESS_REJECTED,
    payload: {
      businessId: parsedId.toString(),
      ownerId: business.ownerId.toString(),
      businessName: business.name,
      status,
      notes,
    },
    status: OutboxStatus.PENDING,
    attempts: 0,
    createdAt: now,
  });

  return {
    id: updated._id.toString(),
    name: updated.name,
    slug: updated.slug,
    status: updated.status,
    reviewNotes: updated.reviewNotes,
    reviewedAt: updated.reviewedAt,
  };
}
