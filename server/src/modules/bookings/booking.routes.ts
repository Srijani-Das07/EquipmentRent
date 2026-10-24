import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import type { PolicyService } from '../../config/policy.service.js';
import {
  availabilityQuerySchema,
  bookingListQuerySchema,
  bookingRequestSchema,
  equipmentIdParamSchema,
  idParamSchema,
  modifyBookingSchema,
  type BookingListQuery,
} from './booking.schemas.js';
import * as svc from './booking.service.js';

const customerOnly = [authenticate, requireRole('CUSTOMER')];
const staffOrAdmin = [authenticate, requireRole('STAFF', 'ADMIN')];

const idOf = (req: Request) => (req.params as { id: string }).id;

/** Mounted at /api/bookings. Fixed paths are registered before "/:id". */
export function createBookingsRouter(policy: PolicyService): Router {
  const router = Router();

  // Public: the availability calendar for one item (F11).
  router.get(
    '/availability/:equipmentId',
    validate({ params: equipmentIdParamSchema, query: availabilityQuerySchema }),
    asyncHandler(async (req, res) => {
      const { equipmentId } = req.params as { equipmentId: string };
      const { month } = req.query as unknown as { month: string };
      res.json(await svc.availabilityCalendar(equipmentId, month, policy));
    }),
  );

  router.post(
    '/quote',
    ...customerOnly,
    validate({ body: bookingRequestSchema }),
    asyncHandler(async (req, res) => {
      res.json({ quote: await svc.quoteBooking(req.body, policy) });
    }),
  );

  router.post(
    '/',
    ...customerOnly,
    validate({ body: bookingRequestSchema }),
    asyncHandler(async (req, res) => {
      res.status(201).json({ booking: await svc.createBooking(req.user!.id, req.body, policy) });
    }),
  );

  router.get(
    '/',
    ...customerOnly,
    validate({ query: bookingListQuerySchema }),
    asyncHandler(async (req, res) => {
      res.json(await svc.listMyBookings(req.user!.id, req.query as unknown as BookingListQuery));
    }),
  );

  router.get(
    '/manage',
    ...staffOrAdmin,
    validate({ query: bookingListQuerySchema }),
    asyncHandler(async (req, res) => {
      res.json(await svc.listAllBookings(req.query as unknown as BookingListQuery));
    }),
  );

  router.get(
    '/:id',
    authenticate,
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
      res.json({ booking: await svc.getBookingFor(req.user!, idOf(req)) });
    }),
  );

  router.get(
    '/:id/cancel-preview',
    ...customerOnly,
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
      res.json({ preview: await svc.previewCancellation(req.user!.id, idOf(req), policy) });
    }),
  );

  router.post(
    '/:id/cancel',
    ...customerOnly,
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
      res.json(await svc.cancelBooking(req.user!.id, idOf(req), policy));
    }),
  );

  router.patch(
    '/:id',
    ...customerOnly,
    validate({ params: idParamSchema, body: modifyBookingSchema }),
    asyncHandler(async (req, res) => {
      res.json({ booking: await svc.modifyBooking(req.user!.id, idOf(req), req.body, policy) });
    }),
  );

  router.post(
    '/:id/handover',
    ...staffOrAdmin,
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
      res.json({ booking: await svc.handoverBooking(req.user!, idOf(req), policy) });
    }),
  );

  return router;
}
