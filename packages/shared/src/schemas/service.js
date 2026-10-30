import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const BufferPlacement = {
  BEFORE: 'before',
  AFTER: 'after',
  BETWEEN: 'between',
};

/**
 * Service creation schema.
 */
export const createServiceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).default(''),
  durationMinutes: z.number().int().min(5, 'Duration must be at least 5 minutes').max(480),
  requiredQualifications: z
    .array(z.string().trim().min(1).max(50))
    .max(10, 'At most 10 required qualifications')
    .default([]),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  bufferPlacement: z
    .enum([BufferPlacement.BEFORE, BufferPlacement.AFTER, BufferPlacement.BETWEEN])
    .default(BufferPlacement.AFTER),
  price: z.number().nonnegative().optional(),
  active: z.boolean().default(true),
  eligibleStaffIds: z.array(objectIdSchema).default([]),
});

/**
 * Service update schema.
 */
export const updateServiceSchema = createServiceSchema.partial();
