import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter, type HealthDeps } from './routes/health.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export type AppDeps = HealthDeps;

/**
 * Builds the Express app from injected dependencies so it can be tested without a real database.
 * Module routers are mounted under /api as they are built.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IPs behind Render/nginx for rate limiting

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: env.isProd ? 300 : 3000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } },
    }),
  );

  app.use('/api/health', healthRouter(deps));
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  // Next module routers are mounted here

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}