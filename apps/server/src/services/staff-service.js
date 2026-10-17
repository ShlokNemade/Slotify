import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { NotFoundError } from '../errors/index.js';

const COLLECTION = 'staff';

/**
 * Convert a stored staff document into the owner-facing API shape.
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
export function toStaffResponse(doc) {
  return {
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    displayName: doc.displayName,
    email: doc.email ?? null,
    qualifications: doc.qualifications ?? [],
    active: doc.active,
    shifts: doc.shifts ?? [],
    breaks: doc.breaks ?? [],
    leave: doc.leave ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Create a staff record for an owned business. Staff are owner-managed
 * records with no login; no credentials are involved.
 * @param {string} businessId
 * @param {Record<string, unknown>} data Zod-validated payload
 * @returns {Promise<Record<string, unknown>>} created staff (owner-facing shape)
 */
export async function createStaff(businessId, data) {
  const db = getDb();
  const now = new Date();

  const staff = {
    ...data,
    businessId: new ObjectId(businessId),
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await db.collection(COLLECTION).insertOne(staff);
  return toStaffResponse({ ...staff, _id: insertResult.insertedId });
}

/**
 * List all staff of a business (owner view, includes inactive).
 * @param {string} businessId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listStaff(businessId) {
  const db = getDb();
  const docs = await db
    .collection(COLLECTION)
    .find({ businessId: new ObjectId(businessId) })
    .sort({ displayName: 1 })
    .toArray();
  return docs.map(toStaffResponse);
}

/**
 * Fetch one staff record of a business or throw NotFoundError.
 * @param {string} businessId
 * @param {string} staffId
 * @returns {Promise<Record<string, unknown>>} stored document
 */
export async function getStaff(businessId, staffId) {
  const db = getDb();
  let parsedStaffId;
  try {
    parsedStaffId = new ObjectId(staffId);
  } catch {
    throw new NotFoundError('Invalid staff identifier');
  }

  const doc = await db.collection(COLLECTION).findOne({
    _id: parsedStaffId,
    businessId: new ObjectId(businessId),
  });
  if (!doc) {
    throw new NotFoundError('Staff member not found');
  }
  return doc;
}

/**
 * Update a staff record with a validated partial patch.
 * @param {string} businessId
 * @param {string} staffId
 * @param {Record<string, unknown>} patch
 * @returns {Promise<Record<string, unknown>>} updated staff (owner-facing shape)
 */
export async function updateStaff(businessId, staffId, patch) {
  await getStaff(businessId, staffId);

  const db = getDb();
  const result = await db
    .collection(COLLECTION)
    .findOneAndUpdate(
      { _id: new ObjectId(staffId), businessId: new ObjectId(businessId) },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

  if (!result) {
    throw new NotFoundError('Staff member not found');
  }
  return toStaffResponse(result);
}

/**
 * Deactivate a staff record (soft delete). Bookings may still reference them.
 * @param {string} businessId
 * @param {string} staffId
 * @returns {Promise<Record<string, unknown>>} deactivated staff
 */
export async function deactivateStaff(businessId, staffId) {
  await getStaff(businessId, staffId);

  const db = getDb();
  const result = await db
    .collection(COLLECTION)
    .findOneAndUpdate(
      { _id: new ObjectId(staffId), businessId: new ObjectId(businessId) },
      { $set: { active: false, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

  if (!result) {
    throw new NotFoundError('Staff member not found');
  }
  return toStaffResponse(result);
}
