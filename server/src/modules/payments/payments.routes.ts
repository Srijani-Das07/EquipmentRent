import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { MockGateway, type PaymentProvider } from './gateway.js';
import { chargeIdParamSchema, chargeListQuerySchema, payChargeSchema } from './payments.schemas.js';
import * as svc from './payments.service.js';

const customerOnly = [authenticate, requireRole('CUSTOMER')];
const idOf = (req: Request) => (req.params as { id: string }).id;

/** Mounted at /api/charges. The gateway is injectable so tests can swap it. */
export function createChargesRouter(gateway: PaymentProvider = new MockGateway()): Router {
  const router = Router();

  router.get(
    '/',
    ...customerOnly,
    validate({ query: chargeListQuerySchema }),
    asyncHandler(async (req, res) => {
      const { status } = req.query as { status?: 'PENDING' | 'PAID' | 'FAILED' | 'VOID' };
      res.json({ charges: await svc.listCharges(req.user!.id, status) });
    }),
  );

  router.get(
    '/:id',
    ...customerOnly,
    validate({ params: chargeIdParamSchema }),
    asyncHandler(async (req, res) => {
      res.json({ charge: await svc.getCharge(req.user!.id, idOf(req)) });
    }),
  );

  router.post(
    '/:id/pay',
    ...customerOnly,
    validate({ params: chargeIdParamSchema, body: payChargeSchema }),
    asyncHandler(async (req, res) => {
      res.json({ payment: await svc.payCharge(req.user!.id, idOf(req), req.body, gateway) });
    }),
  );

  return router;
}

/** Mounted at /api/receipts. */
export const receiptsRouter = Router();

receiptsRouter.get(
  '/',
  ...customerOnly,
  asyncHandler(async (req, res) => {
    res.json({ receipts: await svc.listReceipts(req.user!.id) });
  }),
);

receiptsRouter.get(
  '/:id',
  authenticate,
  validate({ params: chargeIdParamSchema }),
  asyncHandler(async (req, res) => {
    res.json({ receipt: await svc.getReceipt(req.user!, idOf(req)) });
  }),
);
