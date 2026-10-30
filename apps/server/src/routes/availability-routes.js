import { Router } from 'express';
import { computeServiceAvailability } from '../services/availability/availability-service.js';
import { ownerSlotsQuerySchema } from '@slotify/shared';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { requireBusinessOwnership } from '../middleware/tenant.js';

export const availabilityRouter = Router({ mergeParams: true });

// Internal owner view of availability (per-staff breakdown allowed).
availabilityRouter.use(authenticate, requireBusinessOwnership);

/**
 * Owner slot preview: how the engine evaluates bookable starts for a
 * service over a business-local date range. Reveals per-staff breakdown
 * and is safe to expose only to the owner/admin.
 */
availabilityRouter.get(
  '/',
  validate({ query: ownerSlotsQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await computeServiceAvailability({
        business: req.business,
        serviceId: req.query.serviceId,
        query: { fromDate: req.query.fromDate, toDate: req.query.toDate },
        ownerOptions: { staffId: req.query.staffId },
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
