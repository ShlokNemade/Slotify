import { z } from 'zod';
import { objectIdSchema } from './common.js';
import { UserRole } from './user.js';

/**
 * Session entity schema.
 */
export const sessionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  sessionTokenHash: z.string().min(16),
  role: z.enum([UserRole.CUSTOMER, UserRole.OWNER, UserRole.PLATFORM_ADMIN]),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
  createdAt: z.date().or(z.string()),
  expiresAt: z.date().or(z.string()),
  revokedAt: z.date().or(z.string()).nullable().optional(),
});
