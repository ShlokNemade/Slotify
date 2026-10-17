import { Router } from 'express';
import { listBusinessesByStatus, reviewBusiness } from '../services/admin-service.js';
import { reviewBusinessSchema, adminBusinessListQuerySchema } from '@slotify/shared';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { UserRole } from '@slotify/shared';

export const adminRouter = Router({ mergeParams: true });

// Every admin route requires an authenticated platform admin.
adminRouter.use(authenticate, requireRole(UserRole.PLATFORM_ADMIN));

/**
 * List businesses filtered by approval status.
 */
adminRouter.get(
  '/businesses',
  validate({ query: adminBusinessListQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await listBusinessesByStatus(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Approve or reject a business. Rejection requires notes (schema-enforced).
 */
adminRouter.post(
  '/businesses/:businessId/review',
  validate({ body: reviewBusinessSchema }),
  async (req, res, next) => {
    try {
      const business = await reviewBusiness(
        req.user.id,
        req.params.businessId,
        req.body
      );
      res.status(200).json({ success: true, data: { business } });
    } catch (err) {
      next(err);
    }
  }
);
