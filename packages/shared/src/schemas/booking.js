import { z } from 'zod';
import { objectIdSchema, isoDateSchema } from './common.js';

export const BookingStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
};

/**
 * Service snapshot captured at booking time.
 */
export const serviceSnapshotSchema = z.object({
  serviceId: objectIdSchema,
  name: z.string(),
  durationMinutes: z.number().int().positive(),
  bufferMinutes: z.number().int().nonnegative().default(0),
  price: z.number().nonnegative().optional(),
});

/**
 * An individual segment in an atomic multi-service booking.
 */
export const bookingSegmentSchema = z.object({
  service: serviceSnapshotSchema,
  staffId: objectIdSchema,
  startTime: isoDateSchema,
  endTime: isoDateSchema,
});

/**
 * Multi-service booking creation request.
 */
export const createBookingSchema = z.object({
  businessId: objectIdSchema,
  idempotencyKey: z.string().trim().min(8).max(64),
  segments: z
    .array(
      z.object({
        serviceId: objectIdSchema,
        staffId: objectIdSchema.or(z.literal('any')),
        startTime: isoDateSchema,
      })
    )
    .min(1, 'At least one service segment is required'),
});

/**
 * Reschedule booking request.
 */
export const rescheduleBookingSchema = z.object({
  segments: z
    .array(
      z.object({
        serviceId: objectIdSchema,
        staffId: objectIdSchema.or(z.literal('any')),
        startTime: isoDateSchema,
      })
    )
    .min(1),
});

/**
 * Cancel booking request.
 */
export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const updateBookingStatusSchema = z.object({
  status: z.enum([BookingStatus.COMPLETED, BookingStatus.NO_SHOW]),
});
