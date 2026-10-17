import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { NotFoundError, ValidationError } from '../errors/index.js';

const COLLECTION = 'services';

/**
 * Convert a stored service document into the owner-facing API shape.
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
export function toServiceResponse(doc) {
  return {
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    name: doc.name,
    description: doc.description,
    durationMinutes: doc.durationMinutes,
    bufferMinutes: doc.bufferMinutes,
    bufferPlacement: doc.bufferPlacement,
    price: doc.price ?? null,
    active: doc.active,
    eligibleStaffIds: (doc.eligibleStaffIds ?? []).map((id) => id.toString()),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Validate that every eligibleStaffId references an active staff member of the
 * same business. Client-provided staff eligibility is never trusted blindly.
 * @param {string} businessId
 * @param {string[]} staffIds
 */
async function assertStaffBelongToBusiness(businessId, staffIds) {
  if (!staffIds || staffIds.length === 0) {
    return;
  }

  const db = getDb();
  const uniqueIds = [...new Set(staffIds)];
  const objectIds = uniqueIds.map((id) => {
    try {
      return new ObjectId(id);
    } catch {
      throw new ValidationError('eligibleStaffIds contains an invalid staff identifier');
    }
  });

  const matching = await db
    .collection('staff')
    .countDocuments({ _id: { $in: objectIds }, businessId: new ObjectId(businessId) });

  if (matching !== objectIds.length) {
    throw new ValidationError('eligibleStaffIds contains staff that do not belong to this business');
  }
}

/**
 * Create a service for an owned business.
 * @param {string} businessId
 * @param {Record<string, unknown>} data Zod-validated payload
 * @returns {Promise<Record<string, unknown>>} created service (owner-facing shape)
 */
export async function createService(businessId, data) {
  const db = getDb();
  await assertStaffBelongToBusiness(businessId, data.eligibleStaffIds);

  const now = new Date();
  const service = {
    ...data,
    businessId: new ObjectId(businessId),
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await db.collection(COLLECTION).insertOne(service);
  return toServiceResponse({ ...service, _id: insertResult.insertedId });
}

/**
 * List all services of a business (owner view, includes inactive).
 * @param {string} businessId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listServices(businessId) {
  const db = getDb();
  const docs = await db
    .collection(COLLECTION)
    .find({ businessId: new ObjectId(businessId) })
    .sort({ name: 1 })
    .toArray();
  return docs.map(toServiceResponse);
}

/**
 * Fetch one service of a business or throw NotFoundError.
 * @param {string} businessId
 * @param {string} serviceId
 * @returns {Promise<Record<string, unknown>>} stored document
 */
export async function getService(businessId, serviceId) {
  const db = getDb();
  let parsedServiceId;
  try {
    parsedServiceId = new ObjectId(serviceId);
  } catch {
    throw new NotFoundError('Invalid service identifier');
  }

  const doc = await db.collection(COLLECTION).findOne({
    _id: parsedServiceId,
    businessId: new ObjectId(businessId),
  });
  if (!doc) {
    throw new NotFoundError('Service not found');
  }
  return doc;
}

/**
 * Update a service with a validated partial patch.
 * @param {string} businessId
 * @param {string} serviceId
 * @param {Record<string, unknown>} patch
 * @returns {Promise<Record<string, unknown>>} updated service (owner-facing shape)
 */
export async function updateService(businessId, serviceId, patch) {
  await getService(businessId, serviceId);
  await assertStaffBelongToBusiness(businessId, patch.eligibleStaffIds);

  const db = getDb();
  const result = await db
    .collection(COLLECTION)
    .findOneAndUpdate(
      { _id: new ObjectId(serviceId), businessId: new ObjectId(businessId) },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

  if (!result) {
    throw new NotFoundError('Service not found');
  }
  return toServiceResponse(result);
}

/**
 * Deactivate a service (soft delete). Bookings may still reference it.
 * @param {string} businessId
 * @param {string} serviceId
 * @returns {Promise<Record<string, unknown>>} deactivated service
 */
export async function deactivateService(businessId, serviceId) {
  await getService(businessId, serviceId);

  const db = getDb();
  const result = await db
    .collection(COLLECTION)
    .findOneAndUpdate(
      { _id: new ObjectId(serviceId), businessId: new ObjectId(businessId) },
      { $set: { active: false, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

  if (!result) {
    throw new NotFoundError('Service not found');
  }
  return toServiceResponse(result);
}
