import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const NotificationType = {
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  USER_VERIFICATION_REQUESTED: 'user.verification_requested',
};

export const notificationSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  type: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  readAt: z.date().or(z.string()).nullable(),
  createdAt: z.date().or(z.string()),
});
