import { Router } from 'express';
import {
  createBusiness,
  getBusinessById,
  updateBusiness,
  submitBusinessForReview,
  toBusinessResponse,
} from '../services/business-service.js';
import { createBusinessSchema, updateBusinessSchema } from '@slotify/shared';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole, requireVerifiedEmail } from '../middleware/auth.js';
import { requireBusinessOwnership } from '../middleware/tenant.js';
import { UserRole } from '@slotify/shared';

export const businessRouter = Router();

/**
 * Create a new draft business. Requires an authenticated, email-verified owner.
 */
businessRouter.post(
  '/',
  authenticate,
  requireRole(UserRole.OWNER),
  requireVerifiedEmail,
  validate({ body: createBusinessSchema }),
  async (req, res, next) => {
    try {
      const business = await createBusiness({ ownerId: req.user.id, data: req.body });
      res.status(201).json({
        success: true,
        data: { business },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Get an owned business (owner view with internal fields such as review state).
 */
businessRouter.get(
  '/:businessId',
  authenticate,
  requireBusinessOwnership,
  async (req, res, next) => {
    try {
      // req.business is attached by requireBusinessOwnership for owners.
      // Platform admins bypass ownership without the attachment, so fetch directly.
      const business = req.business ?? (await getBusinessById(req.params.businessId));
      res.status(200).json({
        success: true,
        data: { business: toBusinessResponse(business) },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Submit a business for platform-admin review (draft/rejected → pending_approval).
 */
businessRouter.post(
  '/:businessId/submit',
  authenticate,
  requireBusinessOwnership,
  async (req, res, next) => {
    try {
      const business = await submitBusinessForReview(req.params.businessId);
      res.status(200).json({
        success: true,
        data: { business },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Update an owned business (profile, slug, hours, booking policy).
 */
businessRouter.patch(
  '/:businessId',
  authenticate,
  requireBusinessOwnership,
  validate({ body: updateBusinessSchema }),
  async (req, res, next) => {
    try {
      const business = await updateBusiness(req.params.businessId, req.body);
      res.status(200).json({
        success: true,
        data: { business },
      });
    } catch (err) {
      next(err);
    }
  }
);
