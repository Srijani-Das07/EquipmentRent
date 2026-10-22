import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE, toPublicUser, verifySession } from '../modules/auth/auth.service.js';

/** S1: requires a valid session. Deactivated users are rejected even with a valid cookie. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    const userId = typeof token === 'string' ? verifySession(token) : null;
    if (!userId) throw AppError.unauthorized();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw AppError.unauthorized('Session is no longer valid');

    req.user = toPublicUser(user);
    next();
  } catch (err) {
    next(err);
  }
};

/** S2: role-based access control. Use after authenticate. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    next();
  };