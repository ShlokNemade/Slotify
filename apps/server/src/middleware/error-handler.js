import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import { AppError } from '../errors/index.js';

/**
 * Global Express error handling middleware.
 * Returns consistent JSON response:
 * {
 *   success: false,
 *   error: {
 *     code: string,
 *     message: string,
 *     details?: unknown,
 *     correlationId: string
 *   }
 * }
 */
export function errorHandler(err, req, res, _next) {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();

  // 1. Zod Validation Errors
  if (err instanceof ZodError) {
    const formattedIssues = err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    }));

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: formattedIssues,
        correlationId,
      },
    });
  }

  // 2. Custom App Errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        correlationId,
      },
    });
  }

  // 3. MongoDB Duplicate Key Error (E11000)
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_KEY_ERROR',
        message: 'A resource with this identifier already exists',
        details: err.keyValue,
        correlationId,
      },
    });
  }

  // 4. Fallback Internal Server Error
  console.error(`[Unhandled Error] [${correlationId}]:`, err);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred',
      correlationId,
    },
  });
}
