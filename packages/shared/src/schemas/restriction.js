import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const RestrictionCategory = {
  BOOKING_COOLDOWN: 'booking_cooldown',
  EXCESSIVE_CANCELLATIONS: 'excessive_cancellations',
  NO_SHOW_THRESHOLD: 'no_show_threshold',
  MANUAL_BLOCK: 'manual_block',
};

export const RestrictionStatus = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  LIFTED: 'lifted',
};

export const restrictionSchema = z.object({
  id: objectIdSchema,
  businessId: objectIdSchema,
  customerId: objectIdSchema,
  category: z.enum([
    RestrictionCategory.BOOKING_COOLDOWN,
    RestrictionCategory.EXCESSIVE_CANCELLATIONS,
    RestrictionCategory.NO_SHOW_THRESHOLD,
    RestrictionCategory.MANUAL_BLOCK,
  ]),
  status: z.enum([RestrictionStatus.ACTIVE, RestrictionStatus.EXPIRED, RestrictionStatus.LIFTED]),
  reason: z.string().trim().min(3).max(500),
  expiresAt: z.date().or(z.string()).nullable().optional(),
  createdAt: z.date().or(z.string()),
  liftedAt: z.date().or(z.string()).nullable().optional(),
  liftedBy: objectIdSchema.nullable().optional(),
  liftReason: z.string().trim().max(500).optional(),
});
