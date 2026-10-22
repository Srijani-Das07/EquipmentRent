import { Router } from 'express';
import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { createUserSchema, updateUserSchema, userIdParamSchema } from '../auth/auth.schemas.js';
import { createUser, toPublicUser } from '../auth/auth.service.js';

// F5: Admin-only user and role management.
export const usersRouter = Router();
usersRouter.use(authenticate, requireRole('ADMIN'));

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ users: users.map(toPublicUser) });
  }),
);

usersRouter.post(
  '/',
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    const user = await createUser(req.body);
    res.status(201).json({ user: toPublicUser(user) });
  }),
);

usersRouter.patch(
  '/:id',
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw AppError.notFound('User not found');

    const nextRole = req.body.role ?? target.role;
    const nextActive = req.body.isActive ?? target.isActive;

    const losesAdmin =
      target.role === 'ADMIN' && target.isActive && (nextRole !== 'ADMIN' || nextActive === false);

    if (losesAdmin) {
      if (target.id === req.user!.id) {
        throw AppError.conflict('You cannot demote or deactivate your own account');
      }
      const otherAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: target.id } },
      });
      if (otherAdmins === 0) {
        throw AppError.conflict('At least one active administrator is required');
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: nextRole, isActive: nextActive },
    });
    res.json({ user: toPublicUser(updated) });
  }),
);