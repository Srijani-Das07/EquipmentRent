import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import type { PolicyService } from '../../config/policy.service.js';
import { processReturnSchema, returnPreviewQuerySchema } from './returns.schemas.js';
import type { ConditionName } from './returns.rules.js';
import * as svc from './returns.service.js';

const staffOrAdmin = [authenticate, requireRole('STAFF', 'ADMIN')];

/** Mounted at /api/returns. */
export function createReturnsRouter(policy: PolicyService): Router {
  const router = Router();

  router.get(
    '/preview',
    ...staffOrAdmin,
    validate({ query: returnPreviewQuerySchema }),
    asyncHandler(async (req, res) => {
      const { bookingId, condition } = req.query as unknown as { bookingId: string; condition: ConditionName };
      res.json({ preview: await svc.previewReturn(bookingId, condition, policy) });
    }),
  );

  router.post(
    '/',
    ...staffOrAdmin,
    validate({ body: processReturnSchema }),
    asyncHandler(async (req, res) => {
      res.status(201).json(await svc.processReturn(req.user!, req.body, policy));
    }),
  );

  return router;
}
