import { getDb } from '../db/mongo.js';
import { NotFoundError } from '../errors/index.js';
import { BusinessStatus } from '@slotify/shared';

/**
 * Public allowlist projection for directory listings.
 * Never exposes ownerId, review state, full address, or internal policy fields.
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
function toPublicBusinessSummary(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    description: doc.description,
    category: doc.category,
    city: doc.location?.city,
    country: doc.location?.country,
    timeZone: doc.timeZone,
  };
}

/**
 * Returns the ids of businesses that have at least one active service
 * (the "complete" rule for public listing).
 * @returns {Promise<Array<ObjectId>>}
 */
async function businessIdsWithActiveServices() {
  const db = getDb();
  return db.collection('services').distinct('businessId', { active: true });
}

/**
 * Search the public directory: approved, verified, complete businesses only.
 * All filters are applied server-side; pagination defaults come from the
 * shared directoryQuerySchema.
 * @param {{ category?: string, search?: string, city?: string, country?: string, minPrice?: number, maxPrice?: number, page: number, limit: number }} query
 * @returns {Promise<{ businesses: Array<Record<string, unknown>>, total: number, page: number, limit: number }>}
 */
export async function searchDirectory(query) {
  const db = getDb();
  const { category, search, city, country, minPrice, maxPrice, page, limit } = query;

  const filter = { status: BusinessStatus.APPROVED };

  if (category) {
    filter.category = new RegExp(`^${escapeRegExp(category.trim())}$`, 'i');
  }
  if (city) {
    filter['location.city'] = new RegExp(`^${escapeRegExp(city.trim())}$`, 'i');
  }
  if (country) {
    filter['location.country'] = new RegExp(`^${escapeRegExp(country.trim())}$`, 'i');
  }
  if (search) {
    const pattern = new RegExp(escapeRegExp(search.trim()), 'i');
    filter.$or = [{ name: pattern }, { description: pattern }];
  }

  // Displayed-price filter: intersect with businesses offering an active
  // service priced within the requested range.
  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceFilter = { active: true };
    if (minPrice !== undefined || maxPrice !== undefined) {
      priceFilter.price = {};
      if (minPrice !== undefined) {
        priceFilter.price.$gte = minPrice;
      }
      if (maxPrice !== undefined) {
        priceFilter.price.$lte = maxPrice;
      }
    }
    const matchingIds = await db.collection('services').distinct('businessId', priceFilter);
    filter._id = { $in: matchingIds };
  }

  // Completeness gate: at least one active service.
  const activeServiceBusinessIds = await businessIdsWithActiveServices();
  filter._id = filter._id
    ? { $in: filter._id.$in.filter((id) => activeServiceBusinessIds.some((a) => a.equals(id))) }
    : { $in: activeServiceBusinessIds };

  const total = await db.collection('businesses').countDocuments(filter);
  const docs = await db
    .collection('businesses')
    .find(filter)
    .sort({ name: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return {
    businesses: docs.map(toPublicBusinessSummary),
    total,
    page,
    limit,
  };
}

/**
 * Public business profile by slug: approved businesses only, with public
 * service, staff display names, and hours information.
 * @param {string} slug
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getPublicBusinessBySlug(slug) {
  const db = getDb();

  const business = await db.collection('businesses').findOne({
    slug,
    status: BusinessStatus.APPROVED,
  });
  if (!business) {
    throw new NotFoundError('Business not found');
  }

  const activeServiceCount = await db.collection('services').countDocuments({
    businessId: business._id,
    active: true,
  });
  if (activeServiceCount === 0) {
    // Incomplete business: treated as not publicly listed
    throw new NotFoundError('Business not found');
  }

  const services = await db
    .collection('services')
    .find(
      { businessId: business._id, active: true },
      {
        projection: {
          _id: 1,
          name: 1,
          description: 1,
          durationMinutes: 1,
          price: 1,
        },
      }
    )
    .sort({ name: 1 })
    .toArray();

  const staff = await db
    .collection('staff')
    .find(
      { businessId: business._id, active: true },
      { projection: { _id: 1, displayName: 1 } }
    )
    .sort({ displayName: 1 })
    .toArray();

  return {
    id: business._id.toString(),
    name: business.name,
    slug: business.slug,
    description: business.description,
    category: business.category,
    timeZone: business.timeZone,
    location: {
      address: business.location?.address,
      city: business.location?.city,
      country: business.location?.country,
    },
    hours: business.hours,
    defaultSlotIntervalMinutes: business.defaultSlotIntervalMinutes,
    minNoticeHours: business.minNoticeHours,
    maxHorizonDays: business.maxHorizonDays,
    services: services.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      price: s.price ?? null,
    })),
    staff: staff.map((s) => ({
      id: s._id.toString(),
      displayName: s.displayName,
    })),
  };
}

/**
 * Escape user input before embedding into a RegExp.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
