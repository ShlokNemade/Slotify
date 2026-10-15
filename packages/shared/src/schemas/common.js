import { z } from 'zod';

/**
 * Standard 24-character hexadecimal MongoDB ObjectId string validator.
 */
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId string');

/**
 * Valid ISO 8601 date string validator.
 */
export const isoDateSchema = z
  .string()
  .datetime({ offset: true, message: 'Invalid ISO 8601 datetime format' });

/**
 * Normalized lowercase trimmed email validator.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(255, 'Email cannot exceed 255 characters');

/**
 * URL-friendly slug validator (lowercase letters, numbers, hyphens).
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Slug must be at least 3 characters')
  .max(64, 'Slug cannot exceed 64 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must consist of lowercase alphanumeric words separated by hyphens');

/**
 * Valid IANA time zone identifier validator.
 */
export const timeZoneSchema = z.string().trim().refine((tz) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, { message: 'Invalid IANA time zone' });

/**
 * Standard pagination query schema.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
