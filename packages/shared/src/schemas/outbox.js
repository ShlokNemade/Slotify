import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const OutboxStatus = {
  PENDING: 'pending',
  PUBLISHED: 'published',
  FAILED: 'failed',
};

export const OutboxEventType = {
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_RESCHEDULED: 'booking.rescheduled',
  USER_VERIFICATION_REQUESTED: 'user.verification_requested',
  PASSWORD_RESET_REQUESTED: 'user.password_reset_requested',
  REMINDER_24H: 'booking.reminder.24h',
  REMINDER_2H: 'booking.reminder.2h',
};

export const outboxEventSchema = z.object({
  id: objectIdSchema,
  aggregateId: objectIdSchema,
  aggregateType: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.record(z.unknown()),
  status: z.enum([OutboxStatus.PENDING, OutboxStatus.PUBLISHED, OutboxStatus.FAILED]),
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
  createdAt: z.date().or(z.string()),
  publishedAt: z.date().or(z.string()).optional(),
});
