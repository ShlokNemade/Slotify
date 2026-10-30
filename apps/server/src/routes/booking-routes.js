import { Router } from 'express';
import {
  cancelBooking,
  createBooking,
  getBookingForCustomer,
  listBookingsForBusiness,
  listBookingsForCustomer,
  updateBookingStatus,
} from '../services/booking-service.js';
import {
  cancelBookingSchema,
  createBookingSchema,
  updateBookingStatusSchema,
} from '@slotify/shared';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole, requireVerifiedEmail } from '../middleware/auth.js';
import { requireBusinessOwnership } from '../middleware/tenant.js';

export const bookingRouter = Router();
export const bookingManagementRouter = Router({ mergeParams: true });

/**
 * Create a booking (single or multi-service atomic). Customer only;
 * verified email required (acceptance criterion #1). Idempotent retries
 * with the same key replay the same booking.
 */
bookingRouter.post(
  '/',
  authenticate,
  requireRole('customer'),
  requireVerifiedEmail,
  validate({ body: createBookingSchema }),
  async (req, res, next) => {
    try {
      const { booking, idempotentReplay } = await createBooking({
        user: req.user,
        payload: req.body,
      });
      res.status(idempotentReplay ? 200 : 201).json({
        success: true,
        data: { booking, idempotentReplay },
      });
    } catch (err) {
      next(err);
    }
  }
);

bookingRouter.get(
  '/my',
  authenticate,
  requireRole('customer'),
  async (req, res, next) => {
    try {
      res.status(200).json({ success: true, data: await listBookingsForCustomer(req.user) });
    } catch (err) {
      next(err);
    }
  }
);

bookingRouter.post(
  '/:bookingId/cancel',
  authenticate,
  requireRole('customer'),
  requireVerifiedEmail,
  validate({ body: cancelBookingSchema }),
  async (req, res, next) => {
    try {
      const data = await cancelBooking({
        user: req.user,
        bookingId: req.params.bookingId,
        reason: req.body.reason,
      });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Get one of the customer's own bookings.
 */
bookingRouter.get(
  '/:bookingId',
  authenticate,
  requireRole('customer'),
  async (req, res, next) => {
    try {
      const result = await getBookingForCustomer(req.user, req.params.bookingId);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

bookingManagementRouter.get(
  '/:businessId/bookings',
  authenticate,
  requireBusinessOwnership,
  async (req, res, next) => {
    try {
      const data = await listBookingsForBusiness(req.params.businessId, req.query);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

bookingManagementRouter.patch(
  '/:businessId/bookings/:bookingId/status',
  authenticate,
  requireBusinessOwnership,
  validate({ body: updateBookingStatusSchema }),
  async (req, res, next) => {
    try {
      const data = await updateBookingStatus({
        businessId: req.params.businessId,
        bookingId: req.params.bookingId,
        status: req.body.status,
      });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);
