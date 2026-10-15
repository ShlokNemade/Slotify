import { z } from 'zod';
import { objectIdSchema } from './common.js';
import { UserRole } from './user.js';

export const AuditScope = {
  BUSINESS: 'business',
  PLATFORM: 'platform',
  USER: 'user',
};

export const auditEventSchema = z.object({
  id: objectIdSchema,
  actorId: objectIdSchema.nullable(),
  actorRole: z.enum([UserRole.CUSTOMER, UserRole.OWNER, UserRole.PLATFORM_ADMIN, 'system']),
  action: z.string().min(1),
  scope: z.enum([AuditScope.BUSINESS, AuditScope.PLATFORM, AuditScope.USER]),
  businessId: objectIdSchema.optional(),
  targetId: objectIdSchema.optional(),
  targetType: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  timestamp: z.date().or(z.string()),
});
