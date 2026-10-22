import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../env.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import {
  authenticateCredentials,
  clearSessionCookie,
  createUser,
  setSessionCookie,
  toPublicUser,
} from './auth.service.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isProd ? 20 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' } },
});

export const authRouter = Router();

// F1: self-registration always creates a CUSTOMER.
authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const user = await createUser({ ...req.body, role: 'CUSTOMER' });
    setSessionCookie(res, user.id);
    res.status(201).json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const user = await authenticateCredentials(req.body.email, req.body.password);
    setSessionCookie(res, user.id);
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});