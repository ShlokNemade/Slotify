import { z } from 'zod';
import { objectIdSchema } from './common.js';
import { dayOfWeekSchema, timeWindowSchema } from './business.js';

export const staffShiftSchema = z.object({
  day: dayOfWeekSchema,
  windows: z.array(timeWindowSchema).default([]),
});

export const staffBreakSchema = z.object({
  day: dayOfWeekSchema,
  start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:mm 24-hour format'),
  end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:mm 24-hour format'),
  reason: z.string().trim().max(100).optional(),
});

export const staffLeaveSchema = z.object({
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(200).optional(),
});

/**
 * Staff creation schema.
 */
export const createStaffSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255).optional(),
  qualifications: z.array(z.string().trim()).default([]),
  active: z.boolean().default(true),
  shifts: z.array(staffShiftSchema).default([]),
  breaks: z.array(staffBreakSchema).default([]),
  leave: z.array(staffLeaveSchema).default([]),
});

/**
 * Staff update schema.
 */
export const updateStaffSchema = createStaffSchema.partial();
