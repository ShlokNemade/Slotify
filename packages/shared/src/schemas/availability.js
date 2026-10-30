import { z } from 'zod';
import { objectIdSchema, isoDateSchema } from './common.js';
import { timeWindowSchema } from './business.js';

/**
 * Availability exception / schedule block schema.
 *
 * Exactly one *temporal form* must be present:
 * - Date-scoped:    `{ date, isOpen?, windows? }` — business-local calendar date
 * - Instant-scoped: `{ startDateTime, endDateTime }` — UTC range
 *
 * Exactly one *scope level* may be present (or none = business-wide):
 * - `{ staffId }`    blocks/overrides one staff member
 * - `{ serviceId }`  blocks/overrides one service
 * - both present is rejected (ambiguous scope)
 */

const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => {
    const [, m, d] = value.split('-').map(Number);
    // February lengths do not consider leap years here; the availability
    // engine re-checks parseability. This only rejects month/day inversions.
    return m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }, { message: 'Date must be a real calendar date' });

export const createAvailabilityExceptionSchema = z
  .object({
    date: calendarDateSchema.optional(),
    isOpen: z.boolean().optional(),
    windows: z.array(timeWindowSchema).max(10, 'At most 10 windows per exception').optional(),
    staffId: objectIdSchema.optional(),
    serviceId: objectIdSchema.optional(),
    startDateTime: isoDateSchema.optional(),
    endDateTime: isoDateSchema.optional(),
    reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
  })
  .superRefine((data, ctx) => {
    // Scope: staffId and serviceId are mutually exclusive.
    if (data.staffId && data.serviceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An exception may target staff or a service, not both',
        path: ['serviceId'],
      });
    }

    // Temporal form: exactly one of the two forms.
    const hasDate = Boolean(data.date);
    const hasInstants = Boolean(data.startDateTime || data.endDateTime);
    if (hasDate && hasInstants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either a date-scoped or an instant-scoped exception, not both',
        path: ['startDateTime'],
      });
      return;
    }
    if (!hasDate && !hasInstants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A date (YYYY-MM-DD) or an instant range (startDateTime/endDateTime) is required',
        path: ['date'],
      });
      return;
    }

    if (hasInstants) {
      if (!data.startDateTime || !data.endDateTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Instant-scoped exceptions require both startDateTime and endDateTime',
          path: ['endDateTime'],
        });
        return;
      }
      const start = Date.parse(data.startDateTime);
      const end = Date.parse(data.endDateTime);
      if (!(start < end)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'endDateTime must be after startDateTime',
          path: ['endDateTime'],
        });
        return;
      }
      if (data.isOpen !== undefined || data.windows !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'isOpen/windows only apply to date-scoped exceptions',
          path: ['isOpen'],
        });
      }
      return;
    }

    // Date-scoped form rules.
    if (data.isOpen !== undefined && data.windows !== undefined && data.isOpen === false && data.windows.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A closed exception cannot include windows',
        path: ['windows'],
      });
    }
    if (data.isOpen === undefined && data.windows === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date-scoped exceptions require isOpen and/or windows',
        path: ['isOpen'],
      });
    }
  });

/**
 * Update payload. Scope, temporal form and date fields are immutable —
 * changing them means deleting and recreating the exception. Field updates
 * are merged with the current document server-side and re-validated with
 * `createAvailabilityExceptionSchema`, keeping validation single-sourced.
 */
export const updateAvailabilityExceptionSchema = z.object({
  isOpen: z.boolean().optional(),
  windows: z.array(timeWindowSchema).max(10).optional(),
  startDateTime: isoDateSchema.optional(),
  endDateTime: isoDateSchema.optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

/**
 * Owner listing query for availability exceptions.
 */
export const exceptionListQuerySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  staffId: objectIdSchema.optional(),
});

/**
 * Shared core for slot availability queries.
 */
const slotsQueryBase = z.object({
  serviceId: objectIdSchema,
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Owner slot preview query: may also scope to one staff member for an
 * internal per-staff breakdown.
 */
export const ownerSlotsQuerySchema = slotsQueryBase.extend({
  staffId: objectIdSchema.optional(),
});

/**
 * Public bookable-slot query: never accepts a staff filter scoped response
 * beyond merged "any available" slots; staff schedule templates stay private.
 */
export const publicSlotsQuerySchema = slotsQueryBase;

