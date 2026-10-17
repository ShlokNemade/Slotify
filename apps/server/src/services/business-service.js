import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { BusinessStatus } from '@slotify/shared';

const ALL_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Default business hours: closed all week with no windows.
 * @returns {Record<string, { isOpen: boolean, windows: Array<never> }>}
 */
function defaultHours() {
  return Object.fromEntries(
    ALL_DAYS.map((day) => [day, { isOpen: false, windows: [] }])
  );
}

/**
 * Convert a stored business document into the owner-facing API shape.
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
export function toBusinessResponse(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    description: doc.description,
    category: doc.category,
    status: doc.status,
    timeZone: doc.timeZone,
    location: doc.location,
    hours: doc.hours,
    defaultSlotIntervalMinutes: doc.defaultSlotIntervalMinutes,
    minNoticeHours: doc.minNoticeHours,
    maxHorizonDays: doc.maxHorizonDays,
    ownerId: doc.ownerId.toString(),
    reviewNotes: doc.reviewNotes ?? null,
    reviewedAt: doc.reviewedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Create a new draft business for a verified owner.
 * @param {{ ownerId: string, data: Record<string, unknown> }} params
 * @returns {Promise<Record<string, unknown>>} the created business (owner-facing shape)
 */
export async function createBusiness({ ownerId, data }) {
  const db = getDb();
  const now = new Date();

  const business = {
    ...data,
    ownerId: new ObjectId(ownerId),
    status: BusinessStatus.DRAFT,
    hours: defaultHours(),
    reviewNotes: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const insertResult = await db.collection('businesses').insertOne(business);
    return toBusinessResponse({
      ...business,
      _id: insertResult.insertedId,
    });
  } catch (err) {
    // Race backstop: the unique slug index may reject a slug claimed between
    // the pre-check below and this insert. Surface it as a friendly 409.
    if (err && err.code === 11000) {
      throw new ConflictError('A business with this slug already exists');
    }
    throw err;
  }
}

/**
 * Fetch a business by id or throw NotFoundError.
 * @param {string} businessId
 * @returns {Promise<Record<string, unknown>>} stored document
 */
export async function getBusinessById(businessId) {
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
  return business;
}

/**
 * Submit a business for platform review (draft or rejected → pending_approval).
 * @param {string} businessId
 * @returns {Promise<Record<string, unknown>>} updated business (owner-facing shape)
 */
export async function submitBusinessForReview(businessId) {
  const db = getDb();
  const current = await getBusinessById(businessId);

  if (
    current.status !== BusinessStatus.DRAFT &&
    current.status !== BusinessStatus.REJECTED
  ) {
    throw new ValidationError(
      `Business in status "${current.status}" cannot be submitted for review`
    );
  }

  const result = await db
    .collection('businesses')
    .findOneAndUpdate(
      { _id: new ObjectId(businessId) },
      {
        $set: {
          status: BusinessStatus.PENDING_APPROVAL,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

  if (!result) {
    throw new NotFoundError('Business not found');
  }
  return toBusinessResponse(result);
}

/**
 * Update an owned business with a validated partial patch.
 * @param {string} businessId
 * @param {Record<string, unknown>} patch Zod-validated partial update
 * @returns {Promise<Record<string, unknown>>} updated business (owner-facing shape)
 */
export async function updateBusiness(businessId, patch) {
  const db = getDb();
  const current = await getBusinessById(businessId);

  // Resubmission rule (open question #12, minimal default): any profile edit
  // to a rejected business resubmits it for review. Draft stays draft;
  // approved businesses remain approved (publication state unchanged).
  const resubmit = current.status === BusinessStatus.REJECTED;

  // Hours arrive as a partial day-record (only provided days are present).
  // Merge with the stored hours so omitted days keep their configuration
  // instead of being replaced wholesale by $set.
  const { hours, ...rest } = patch;
  const update = {
    $set: {
      ...rest,
      ...(hours
        ? { hours: { ...current.hours, ...hours } }
        : {}),
      ...(resubmit ? { status: BusinessStatus.PENDING_APPROVAL } : {}),
      updatedAt: new Date(),
    },
  };

  let result;
  try {
    result = await db
      .collection('businesses')
      .findOneAndUpdate({ _id: new ObjectId(businessId) }, update, {
        returnDocument: 'after',
      });
  } catch (err) {
    if (err && err.code === 11000) {
      throw new ConflictError('A business with this slug already exists');
    }
    throw err;
  }

  if (!result) {
    throw new NotFoundError('Business not found');
  }
  return toBusinessResponse(result);
}
