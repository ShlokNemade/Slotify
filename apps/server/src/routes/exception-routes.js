import { Router } from 'express';
import {
  createException,
  listExceptions,
  updateException,
  deleteException,
} from '../services/exception-service.js';
import {
  createAvailabilityExceptionSchema,
  updateAvailabilityExceptionSchema,
  exceptionListQuerySchema,
} from '@slotify/shared';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { requireBusinessOwnership } from '../middleware/tenant.js';

export const exceptionRouter = Router({ mergeParams: true });

// Tenant-scoped owner operations.
exceptionRouter.use(authenticate, requireBusinessOwnership);

/**
 * Create an availability exception. The response includes a `conflicts`
 * array of overlapping ACTIVE bookings as a WARNING — the exception is
 * stored and bookings are never altered (invariant: adding a schedule
 * block never silently changes or cancels existing bookings).
 */
exceptionRouter.post(
  '/',
  validate({ body: createAvailabilityExceptionSchema }),
  async (req, res, next) => {
    try {
      const { exception, conflicts } = await createException(
        req.params.businessId,
        req.business,
        req.body
      );
      res.status(201).json({ success: true, data: { exception, conflicts } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * List availability exceptions, optionally filtered by range or staff.
 */
exceptionRouter.get(
  '/',
  validate({ query: exceptionListQuerySchema }),
  async (req, res, next) => {
    try {
      const exceptions = await listExceptions(req.params.businessId, req.business, req.query);
      res.status(200).json({ success: true, data: { exceptions } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Update mutable fields (isOpen/windows/instants/reason). Response re-runs
 * the conflict scan for the new schedule.
 */
exceptionRouter.patch(
  '/:exceptionId',
  validate({ body: updateAvailabilityExceptionSchema }),
  async (req, res, next) => {
    try {
      const { exception, conflicts } = await updateException(
        req.params.businessId,
        req.business,
        req.params.exceptionId,
        req.body
      );
      res.status(200).json({ success: true, data: { exception, conflicts } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Delete an availability exception.
 */
exceptionRouter.delete('/:exceptionId', async (req, res, next) => {
  try {
    const { exception } = await deleteException(req.params.businessId, req.params.exceptionId);
    res.status(200).json({ success: true, data: { exception } });
  } catch (err) {
    next(err);
  }
});
