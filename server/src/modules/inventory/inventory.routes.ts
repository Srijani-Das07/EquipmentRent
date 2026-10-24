import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  createCategorySchema,
  createEquipmentSchema,
  createUnitSchema,
  equipmentListQuerySchema,
  idParamSchema,
  updateCategorySchema,
  updateEquipmentSchema,
  updateUnitSchema,
  type EquipmentListQuery,
} from './inventory.schemas.js';
import * as svc from './inventory.service.js';

const adminOnly = [authenticate, requireRole('ADMIN')];
const staffOrAdmin = [authenticate, requireRole('STAFF', 'ADMIN')];

const idOf = (req: Request) => (req.params as { id: string }).id;

// ---- /api/categories ---------------------------------------------------------

export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ categories: await svc.listCategories() });
  }),
);

categoriesRouter.post(
  '/',
  ...adminOnly,
  validate({ body: createCategorySchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ category: await svc.createCategory(req.body) });
  }),
);

categoriesRouter.patch(
  '/:id',
  ...adminOnly,
  validate({ params: idParamSchema, body: updateCategorySchema }),
  asyncHandler(async (req, res) => {
    res.json({ category: await svc.updateCategory(idOf(req), req.body) });
  }),
);

categoriesRouter.delete(
  '/:id',
  ...adminOnly,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await svc.deleteCategory(idOf(req));
    res.status(204).end();
  }),
);

// ---- /api/equipment ----------------------------------------------------------

export const equipmentRouter = Router();

equipmentRouter.get(
  '/',
  validate({ query: equipmentListQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await svc.listEquipment(req.query as unknown as EquipmentListQuery, { publicOnly: true }));
  }),
);

// Must be registered before "/:id" so that "manage" is not read as an id.
equipmentRouter.get(
  '/manage',
  ...staffOrAdmin,
  validate({ query: equipmentListQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await svc.listEquipment(req.query as unknown as EquipmentListQuery, { publicOnly: false }));
  }),
);

equipmentRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    res.json({ equipment: await svc.getEquipment(idOf(req), { publicOnly: true }) });
  }),
);

equipmentRouter.post(
  '/',
  ...adminOnly,
  validate({ body: createEquipmentSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ equipment: await svc.createEquipment(req.body) });
  }),
);

equipmentRouter.patch(
  '/:id',
  ...adminOnly,
  validate({ params: idParamSchema, body: updateEquipmentSchema }),
  asyncHandler(async (req, res) => {
    res.json({ equipment: await svc.updateEquipment(idOf(req), req.body) });
  }),
);

equipmentRouter.delete(
  '/:id',
  ...adminOnly,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await svc.deleteEquipment(idOf(req));
    res.status(204).end();
  }),
);

equipmentRouter.get(
  '/:id/units',
  ...staffOrAdmin,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    res.json({ units: await svc.listUnits(idOf(req)) });
  }),
);

equipmentRouter.post(
  '/:id/units',
  ...adminOnly,
  validate({ params: idParamSchema, body: createUnitSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ unit: await svc.createUnit(idOf(req), req.body.tag) });
  }),
);

// ---- /api/units --------------------------------------------------------------

export const unitsRouter = Router();

unitsRouter.patch(
  '/:id',
  ...staffOrAdmin,
  validate({ params: idParamSchema, body: updateUnitSchema }),
  asyncHandler(async (req, res) => {
    res.json({ unit: await svc.changeUnitStatus(idOf(req), req.body.status) });
  }),
);