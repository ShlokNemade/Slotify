import { z } from 'zod';
import { slugSchema, timeZoneSchema } from './common.js';

export const BusinessStatus = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export const dayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

export const timeWindowSchema = z.object({
  open: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:mm 24-hour format'),
  close: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:mm 24-hour format'),
});

export const businessHoursDaySchema = z.object({
  isOpen: z.boolean(),
  windows: z.array(timeWindowSchema).default([]),
});

export const businessHoursSchema = z.record(dayOfWeekSchema, businessHoursDaySchema);

/**
 * Business creation schema.
 */
export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: slugSchema,
  description: z.string().trim().max(1000).default(''),
  category: z.string().trim().min(2).max(50),
  timeZone: timeZoneSchema.default('UTC'),
  location: z.object({
    address: z.string().trim().min(3).max(200),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: z.string().trim().min(2).max(100),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }),
  defaultSlotIntervalMinutes: z.number().int().min(5).max(120).default(30),
  minNoticeHours: z.number().int().min(0).max(720).default(2),
  maxHorizonDays: z.number().int().min(1).max(365).default(60),
});

/**
 * Business update schema.
 */
export const updateBusinessSchema = createBusinessSchema.partial().extend({
  hours: businessHoursSchema.optional(),
});

/**
 * Platform admin business approval/rejection schema.
 */
export const reviewBusinessSchema = z
  .object({
    status: z.enum([BusinessStatus.APPROVED, BusinessStatus.REJECTED]),
    notes: z.string().trim().max(500).default(''),
  })
  .refine(
    (data) => {
      if (data.status === BusinessStatus.REJECTED && !data.notes) {
        return false;
      }
      return true;
    },
    { message: 'Rejection reason is required when rejecting a business', path: ['notes'] }
  );

/**
 * Public directory search & filtering query schema.
 */
export const directoryQuerySchema = z.object({
  category: z.string().trim().optional(),
  search: z.string().trim().optional(),
  city: z.string().trim().optional(),
  country: z.string().trim().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

