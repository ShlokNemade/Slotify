import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { authRouter } from './routes/auth-routes.js';
import { healthRouter } from './routes/health-routes.js';
import { adminRouter } from './routes/admin-routes.js';
import { businessRouter } from './routes/business-routes.js';
import { directoryRouter } from './routes/directory-routes.js';
import { serviceRouter } from './routes/service-routes.js';
import { staffRouter } from './routes/staff-routes.js';
import { exceptionRouter } from './routes/exception-routes.js';
import { errorHandler } from './middleware/error-handler.js';
import { NotFoundError } from './errors/index.js';

/**
 * Express application factory.
 */
export function createApp() {
  const app = express();

  // 1. Security & Core Middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );
  app.use(cookieParser(config.COOKIE_SECRET));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 2. Health & Operational routes
  app.use('/', healthRouter);
  app.use('/api/v1', healthRouter);

  // 3. API Route Modules
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/businesses', businessRouter);
  app.use('/api/v1/businesses/:businessId/services', serviceRouter);
  app.use('/api/v1/businesses/:businessId/staff', staffRouter);
  app.use('/api/v1/businesses/:businessId/exceptions', exceptionRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/directory', directoryRouter);

  // 4. Fallback 404 handler
  app.use((_req, _res, next) => {
    next(new NotFoundError('The requested resource was not found on this server'));
  });

  // 5. Centralized Error Handler
  app.use(errorHandler);

  return app;
}
