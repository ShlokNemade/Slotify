import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/index.js';
import { UserRole } from '@slotify/shared';

/**
 * Tenant isolation middleware.
 * Verifies that the authenticated user is either:
 * 1. The verified owner of the business referenced by :businessId
 * 2. A platform admin
 *
 * Attaches req.business to the request.
 */
export async function requireBusinessOwnership(req, _res, next) {
  try {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    // Platform admins bypass business ownership restriction
    if (req.user.role === UserRole.PLATFORM_ADMIN) {
      return next();
    }

    if (req.user.role !== UserRole.OWNER) {
      throw new ForbiddenError('Only business owners can perform this operation');
    }

    const businessId = req.params.businessId || req.body.businessId;
    if (!businessId) {
      throw new ForbiddenError('Business context is required');
    }

    let parsedBusinessId;
    try {
      parsedBusinessId = new ObjectId(businessId);
    } catch {
      throw new NotFoundError('Invalid business identifier');
    }

    const db = getDb();
    const business = await db.collection('businesses').findOne({
      _id: parsedBusinessId,
    });

    if (!business) {
      throw new NotFoundError('Business not found');
    }

    if (business.ownerId.toString() !== req.user.id) {
      throw new ForbiddenError('Access denied: You do not own this business');
    }

    req.business = business;
    next();
  } catch (err) {
    next(err);
  }
}
