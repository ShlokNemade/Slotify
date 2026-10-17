import { Router } from 'express';
import {
  createStaff,
  listStaff,
  getStaff,
  updateStaff,
  deactivateStaff,
  toStaffResponse,
} from '../services/staff-service.js';
import { createStaffSchema, updateStaffSchema } from '@slotify/shared';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { requireBusinessOwnership } from '../middleware/tenant.js';

export const staffRouter = Router({ mergeParams: true });

// All staff routes are tenant-scoped owner operations.
staffRouter.use(authenticate, requireBusinessOwnership);

/**
 * Create a staff record for the business (owner-managed, no login).
 */
staffRouter.post(
  '/',
  validate({ body: createStaffSchema }),
  async (req, res, next) => {
    try {
      const staff = await createStaff(req.params.businessId, req.body);
      res.status(201).json({ success: true, data: { staff } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * List all staff of the business (owner view, includes inactive).
 */
staffRouter.get('/', async (req, res, next) => {
  try {
    const staff = await listStaff(req.params.businessId);
    res.status(200).json({ success: true, data: { staff } });
  } catch (err) {
    next(err);
  }
});

/**
 * Get a single staff record of the business.
 */
staffRouter.get('/:staffId', async (req, res, next) => {
  try {
    const doc = await getStaff(req.params.businessId, req.params.staffId);
    res.status(200).json({ success: true, data: { staff: toStaffResponse(doc) } });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a staff record (display name, qualifications, shifts, breaks, leave).
 */
staffRouter.patch(
  '/:staffId',
  validate({ body: updateStaffSchema }),
  async (req, res, next) => {
    try {
      const staff = await updateStaff(req.params.businessId, req.params.staffId, req.body);
      res.status(200).json({ success: true, data: { staff } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Deactivate a staff record (soft delete; bookings may still reference them).
 */
staffRouter.delete('/:staffId', async (req, res, next) => {
  try {
    const staff = await deactivateStaff(req.params.businessId, req.params.staffId);
    res.status(200).json({ success: true, data: { staff } });
  } catch (err) {
    next(err);
  }
});
