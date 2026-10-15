import { z } from 'zod';
import { emailSchema, objectIdSchema } from './common.js';

export const UserRole = {
  CUSTOMER: 'customer',
  OWNER: 'owner',
  PLATFORM_ADMIN: 'platform_admin',
};

export const AccountStatus = {
  PENDING_VERIFICATION: 'pending_verification',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
};

/**
 * User registration request schema.
 */
export const registerUserSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password cannot exceed 128 characters'),
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters'),
  role: z
    .enum([UserRole.CUSTOMER, UserRole.OWNER], {
      errorMap: () => ({ message: 'Role must be either customer or owner' }),
    })
    .default(UserRole.CUSTOMER),
});

/**
 * User login request schema.
 */
export const loginUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

/**
 * Email verification request schema.
 */
export const verifyEmailSchema = z.object({
  token: z.string().trim().min(16, 'Invalid verification token'),
});

/**
 * Password reset request schema.
 */
export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

/**
 * Complete password reset request schema.
 */
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(16, 'Invalid reset token'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password cannot exceed 128 characters'),
});

/**
 * Safe user profile response schema (never leaks password or tokens).
 */
export const safeUserSchema = z.object({
  id: objectIdSchema,
  email: emailSchema,
  fullName: z.string(),
  role: z.enum([UserRole.CUSTOMER, UserRole.OWNER, UserRole.PLATFORM_ADMIN]),
  accountStatus: z.enum([
    AccountStatus.PENDING_VERIFICATION,
    AccountStatus.ACTIVE,
    AccountStatus.SUSPENDED,
  ]),
  isEmailVerified: z.boolean(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});
