import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { clearMaintenanceSchema, queueQuerySchema, unitIdParamSchema, type QueueQuery } from './maintenance.schemas.js';
import * as svc from './maintenance.service.js';

const staffOrAdmin = [authenticate, requireRole('STAFF', 'ADMIN')];
const unitIdOf = (req: Request) => (req.params as { unitId: string }).unitId;

/** Mounted at /api/maintenance. */
export const maintenanceRouter = Router();

maintenanceRouter.get(
  '/',
  ...staffOrAdmin,
  validate({ query: queueQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await svc.listQueue((req.query as unknown as QueueQuery).view));
  }),
);

maintenanceRouter.post(
  '/units/:unitId/clear',
  ...staffOrAdmin,
  validate({ params: unitIdParamSchema, body: clearMaintenanceSchema }),
  asyncHandler(async (req, res) => {
    res.json({ unit: await svc.clearMaintenance(req.user!, unitIdOf(req), req.body.notes) });
  }),
);
