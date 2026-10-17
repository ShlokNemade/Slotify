import { Router } from 'express';
import {
  createService,
  listServices,
  getService,
  updateService,
  deactivateService,
  toServiceResponse,
} from '../services/service-service.js';
import { createServiceSchema, updateServiceSchema } from '@slotify/shared';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { requireBusinessOwnership } from '../middleware/tenant.js';

export const serviceRouter = Router({ mergeParams: true });

// All service routes are tenant-scoped owner operations.
serviceRouter.use(authenticate, requireBusinessOwnership);

/**
 * Create a service for the business.
 */
serviceRouter.post(
  '/',
  validate({ body: createServiceSchema }),
  async (req, res, next) => {
    try {
      const service = await createService(req.params.businessId, req.body);
      res.status(201).json({ success: true, data: { service } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * List all services of the business (owner view, includes inactive).
 */
serviceRouter.get('/', async (req, res, next) => {
  try {
    const services = await listServices(req.params.businessId);
    res.status(200).json({ success: true, data: { services } });
  } catch (err) {
    next(err);
  }
});

/**
 * Get a single service of the business.
 */
serviceRouter.get('/:serviceId', async (req, res, next) => {
  try {
    const doc = await getService(req.params.businessId, req.params.serviceId);
    res.status(200).json({ success: true, data: { service: toServiceResponse(doc) } });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a service.
 */
serviceRouter.patch(
  '/:serviceId',
  validate({ body: updateServiceSchema }),
  async (req, res, next) => {
    try {
      const service = await updateService(req.params.businessId, req.params.serviceId, req.body);
      res.status(200).json({ success: true, data: { service } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Deactivate a service (soft delete; bookings may still reference it).
 */
serviceRouter.delete('/:serviceId', async (req, res, next) => {
  try {
    const service = await deactivateService(req.params.businessId, req.params.serviceId);
    res.status(200).json({ success: true, data: { service } });
  } catch (err) {
    next(err);
  }
});
