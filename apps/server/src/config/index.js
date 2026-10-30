import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  MONGODB_URI: z
    .string()
    .min(1)
    .default('mongodb://localhost:27017/slotify?replicaSet=rs0&directConnection=true'),
  SESSION_SECRET: z.string().min(16).default('slotify-dev-session-secret-min-16-chars'),
  COOKIE_SECRET: z.string().min(16).default('slotify-dev-cookie-secret-min-16-chars'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 7), // 7 days
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().email().default('notifications@slotify.local'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const config = parsed.data;
