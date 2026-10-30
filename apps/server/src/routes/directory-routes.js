import { Router } from 'express';
import { searchDirectory, getPublicBusinessBySlug } from '../services/directory-service.js';
import {
  getApprovedBusinessBySlugForSlots,
  computeServiceAvailability,
} from '../services/availability/availability-service.js';
import { directoryQuerySchema, publicSlotsQuerySchema } from '@slotify/shared';
import { validate } from '../middleware/validate.js';

export const directoryRouter = Router({ mergeParams: true });

/**
 * Public directory listing. No authentication; approved and complete
 * businesses only; allowlisted fields.
 */
directoryRouter.get(
  '/businesses',
  validate({ query: directoryQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await searchDirectory(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Public business profile by slug. No authentication; approved and complete
 * businesses only; public projections (services, staff display names, hours).
 */
directoryRouter.get('/businesses/:slug', async (req, res, next) => {
  try {
    const business = await getPublicBusinessBySlug(req.params.slug);
    res.status(200).json({ success: true, data: { business } });
  } catch (err) {
    next(err);
  }
});

/**
 * Public bookable slots for one service of an approved business. Merged
 * "any available" view only — never weekly shift templates or internal
 * staff scoping. Draft/pending/rejected businesses 404 like the profile.
 */
directoryRouter.get(
  '/businesses/:slug/slots',
  validate({ query: publicSlotsQuerySchema }),
  async (req, res, next) => {
    try {
      const business = await getApprovedBusinessBySlugForSlots(req.params.slug);
      const result = await computeServiceAvailability({
        business,
        serviceId: req.query.serviceId,
        query: { fromDate: req.query.fromDate, toDate: req.query.toDate },
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
