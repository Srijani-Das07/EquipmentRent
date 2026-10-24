import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { makeReference } from '../../lib/ids.js';
import { addDays, dateInZone, zonedDateTimeToUtc } from '../../lib/time.js';
import type { PolicyService } from '../../config/policy.service.js';
import { computeCancellation, isLateCancellation, lateCancellationFeePaise } from '../payments/fees.js';
import { issueRefund, refundableBase } from '../payments/payments.service.js';
import {
  buildRentalWindow,
  calculateBookingCost,
  dailyFreeCounts,
  findAlternativeWindows,
  freeUnitIds,
  isChangeable,
  type BookedSpan,
  type RentalWindow,
  type WindowSettings,
} from './booking.rules.js';
import type { BookingListQuery, BookingRequest, ModifyBookingInput } from './booking.schemas.js';
import { expireStaleHolds } from './holds.js';
import { reassignBooking } from './reassign.js';

type Db = Prisma.TransactionClient;
type Actor = { id: string; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' };

// ---- shapes ---------------------------------------------------------------------

const bookingInclude = {
  unit: { include: { equipment: { include: { category: true } } } },
  customer: { select: { id: true, name: true, email: true } },
  charges: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export function toBookingDto(b: BookingRow) {
  const pendingPaise = b.charges.filter((c) => c.status === 'PENDING').reduce((sum, c) => sum + c.amountPaise, 0);
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
    rentalDays: b.rentalDays,
    dailyRatePaise: b.dailyRatePaise,
    costPaise: b.costPaise,
    holdExpiresAt: b.holdExpiresAt,
    handedOverAt: b.handedOverAt,
    cancelledAt: b.cancelledAt,
    createdAt: b.createdAt,
    equipment: { id: b.unit.equipment.id, name: b.unit.equipment.name, category: b.unit.equipment.category.name },
    unitTag: b.unit.tag,
    customer: b.customer,
    charges: b.charges.map((c) => ({
      id: c.id,
      type: c.type,
      amountPaise: c.amountPaise,
      status: c.status,
      description: c.description,
      createdAt: c.createdAt,
      paidAt: c.paidAt,
    })),
    pendingPaise,
    canChange: isChangeable(b.status),
  };
}

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** The database refused an overlapping booking (exclusion constraint booking_no_overlap). */
const isOverlapViolation = (err: unknown): boolean =>
  !isUniqueViolation(err) && err instanceof Error && /booking_no_overlap|exclusion constraint|23P01/i.test(err.message);

const settingsOf = (policy: PolicyService): WindowSettings => {
  const sys = policy.getSystem();
  return { pickupTime: sys.pickup_time, timezone: sys.timezone };
};

// ---- loading helpers -------------------------------------------------------------

async function getActiveEquipment(equipmentId: string) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId }, include: { category: true } });
  if (!equipment || equipment.retiredAt !== null) throw AppError.notFound('Equipment not found');
  return equipment;
}

/** Units that can take a new booking: in service and not flagged for maintenance (F24). */
async function getBookableUnitIds(equipmentId: string): Promise<string[]> {
  const units = await prisma.equipmentUnit.findMany({
    where: { equipmentId, status: 'AVAILABLE', maintenanceDue: false },
    select: { id: true },
    orderBy: [{ lifetimeRentals: 'asc' }, { tag: 'asc' }],
  });
  return units.map((u) => u.id);
}

/** Bookings that currently block their unit during [from, to). */
async function loadSpans(
  unitIds: string[],
  from: Date,
  to: Date,
  now: Date,
  excludeBookingId?: string,
): Promise<BookedSpan[]> {
  if (unitIds.length === 0) return [];
  const rows = await prisma.booking.findMany({
    where: {
      unitId: { in: unitIds },
      startAt: { lt: to },
      endAt: { gt: from },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      OR: [{ status: { in: ['CONFIRMED', 'ACTIVE'] } }, { status: 'PENDING', holdExpiresAt: { gt: now } }],
    },
    select: { unitId: true, startAt: true, endAt: true },
  });
  return rows;
}

async function loadBooking(id: string): Promise<BookingRow> {
  const row = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!row) throw AppError.notFound('Booking not found');
  return row;
}

/** A customer only ever sees their own bookings; anyone else gets "not found". */
async function loadOwnedBooking(id: string, customerId: string): Promise<BookingRow> {
  const row = await loadBooking(id);
  if (row.customerId !== customerId) throw AppError.notFound('Booking not found');
  return row;
}

async function alternativesFor(
  unitIds: string[],
  window: RentalWindow,
  startDate: string,
  settings: WindowSettings,
  now: Date,
  excludeBookingId?: string,
) {
  const horizonEnd = new Date(window.startAt.getTime() + (61 + window.days) * 86_400_000);
  const spans = await loadSpans(unitIds, window.startAt, horizonEnd, now, excludeBookingId);
  return findAlternativeWindows({ unitIds, spans, startDate, days: window.days, settings, now });
}

function noAvailability(alternatives: unknown) {
  return AppError.conflict('No unit of this equipment is free for the selected dates', { alternatives });
}

// ---- availability and quote (F10, F11, F15) -----------------------------------------

export async function availabilityCalendar(equipmentId: string, month: string, policy: PolicyService) {
  const now = new Date();
  await expireStaleHolds(now);
  await getActiveEquipment(equipmentId);
  const settings = settingsOf(policy);

  const [yearText = '0', monthText = '0'] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const first = `${month}-01`;
  const dates = Array.from({ length: lastDay }, (_, i) => addDays(first, i));

  const unitIds = await getBookableUnitIds(equipmentId);
  const from = zonedDateTimeToUtc(first, settings.pickupTime, settings.timezone);
  const to = zonedDateTimeToUtc(addDays(first, lastDay), settings.pickupTime, settings.timezone);
  const spans = await loadSpans(unitIds, from, to, now);

  return {
    month,
    totalUnits: unitIds.length,
    today: dateInZone(now, settings.timezone),
    days: dailyFreeCounts({ unitIds, spans, dates, settings }),
  };
}

export async function quoteBooking(input: BookingRequest, policy: PolicyService) {
  const now = new Date();
  await expireStaleHolds(now);
  const equipment = await getActiveEquipment(input.equipmentId);
  const settings = settingsOf(policy);
  const window = buildRentalWindow(input.startDate, input.endDate, settings, now);

  const unitIds = await getBookableUnitIds(equipment.id);
  const spans = await loadSpans(unitIds, window.startAt, window.endAt, now);
  const free = freeUnitIds(unitIds, spans, window.startAt, window.endAt);

  return {
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    startAt: window.startAt,
    endAt: window.endAt,
    days: window.days,
    dailyRatePaise: equipment.dailyRatePaise,
    costPaise: calculateBookingCost(equipment.dailyRatePaise, window.days),
    available: free.length > 0,
    freeUnits: free.length,
    alternatives: free.length > 0 ? [] : await alternativesFor(unitIds, window, input.startDate, settings, now),
  };
}

// ---- creating a booking (F10, F11, F16) -----------------------------------------------

/**
 * Creates a Pending booking with its payment hold and booking charge. A free unit is picked
 * and the booking is inserted; if another customer wins the same unit at the same moment, the
 * database overlap constraint rejects the insert and the next free unit is tried (P3).
 */
export async function createBooking(customerId: string, input: BookingRequest, policy: PolicyService) {
  const now = new Date();
  await expireStaleHolds(now);
  const equipment = await getActiveEquipment(input.equipmentId);
  const settings = settingsOf(policy);
  const window = buildRentalWindow(input.startDate, input.endDate, settings, now);

  const unitIds = await getBookableUnitIds(equipment.id);
  const spans = await loadSpans(unitIds, window.startAt, window.endAt, now);
  const candidates = freeUnitIds(unitIds, spans, window.startAt, window.endAt);

  const cost = calculateBookingCost(equipment.dailyRatePaise, window.days);
  const holdExpiresAt = new Date(now.getTime() + policy.getSystem().payment_hold_minutes * 60_000);

  for (const unitId of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await prisma.booking.create({
          data: {
            reference: makeReference('BK', now),
            customerId,
            unitId,
            startAt: window.startAt,
            endAt: window.endAt,
            rentalDays: window.days,
            dailyRatePaise: equipment.dailyRatePaise,
            costPaise: cost,
            status: 'PENDING',
            holdExpiresAt,
            charges: {
              create: {
                type: 'BOOKING',
                amountPaise: cost,
                description: `${equipment.name}, ${window.days} day(s)`,
              },
            },
          },
          include: bookingInclude,
        });
        return toBookingDto(row);
      } catch (err) {
        if (isUniqueViolation(err)) continue; // reference collision: try a new reference
        if (isOverlapViolation(err)) break; // someone else took this unit: try the next one
        throw err;
      }
    }
  }

  throw noAvailability(await alternativesFor(unitIds, window, input.startDate, settings, now));
}

// ---- reading bookings ---------------------------------------------------------------

export async function listMyBookings(customerId: string, query: BookingListQuery) {
  await expireStaleHolds();
  const where: Prisma.BookingWhereInput = { customerId, ...(query.status ? { status: query.status } : {}) };
  return paged(where, query);
}

export async function listAllBookings(query: BookingListQuery) {
  await expireStaleHolds();
  const where: Prisma.BookingWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.search) {
    where.OR = [
      { reference: { contains: query.search, mode: 'insensitive' } },
      { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      { customer: { email: { contains: query.search, mode: 'insensitive' } } },
      { unit: { equipment: { name: { contains: query.search, mode: 'insensitive' } } } },
    ];
  }
  return paged(where, query);
}

async function paged(where: Prisma.BookingWhereInput, query: BookingListQuery) {
  const [total, rows] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map(toBookingDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getBookingFor(actor: Actor, id: string) {
  await expireStaleHolds();
  const row = actor.role === 'CUSTOMER' ? await loadOwnedBooking(id, actor.id) : await loadBooking(id);
  return toBookingDto(row);
}

// ---- cancelling (F13, F14, F18) -----------------------------------------------------

function policyFor(booking: BookingRow, policy: PolicyService) {
  const equipment = booking.unit.equipment;
  return policy.getPolicy({ equipmentId: equipment.id, categorySlug: equipment.category.slug });
}

/** What a cancellation would cost right now, without changing anything. */
export async function previewCancellation(customerId: string, id: string, policy: PolicyService) {
  const now = new Date();
  await expireStaleHolds(now);
  const booking = await loadOwnedBooking(id, customerId);
  if (!isChangeable(booking.status)) throw AppError.conflict('Only pending or confirmed bookings can be cancelled');

  const pct = policyFor(booking, policy).lateCancellationFeePct;
  const paid = await refundableBase(prisma, booking.id);
  const outcome = computeCancellation({
    status: booking.status,
    costPaise: booking.costPaise,
    paidPaise: paid,
    startAt: booking.startAt,
    now,
    lateCancellationFeePct: pct,
  });
  return { ...outcome, lateCancellationFeePct: pct, paidPaise: paid };
}

export async function cancelBooking(customerId: string, id: string, policy: PolicyService) {
  const now = new Date();
  await expireStaleHolds(now);
  const booking = await loadOwnedBooking(id, customerId);
  if (!isChangeable(booking.status)) throw AppError.conflict('Only pending or confirmed bookings can be cancelled');
  const pct = policyFor(booking, policy).lateCancellationFeePct;

  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.booking.updateMany({
      where: { id, status: booking.status },
      data: { status: 'CANCELLED', cancelledAt: now, holdExpiresAt: null },
    });
    if (claimed.count !== 1) throw AppError.conflict('This booking was just changed. Please refresh and try again.');

    // Anything still unpaid on this booking is no longer owed.
    await tx.charge.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'VOID' } });

    const paid = await refundableBase(tx, id);
    const result = computeCancellation({
      status: booking.status as 'PENDING' | 'CONFIRMED',
      costPaise: booking.costPaise,
      paidPaise: paid,
      startAt: booking.startAt,
      now,
      lateCancellationFeePct: pct,
    });

    if (result.feePaise > 0) {
      await tx.charge.create({
        data: {
          bookingId: id,
          type: 'LATE_CANCELLATION',
          amountPaise: result.feePaise,
          status: 'PAID',
          paidAt: now,
          description: `Late cancellation fee (${pct}% of the booking cost), kept from the booking payment`,
          policySnapshot: { lateCancellationFeePct: pct, costPaise: booking.costPaise, startAt: booking.startAt.toISOString() },
        },
      });
    }
    if (result.refundPaise > 0) await issueRefund(tx, { bookingId: id, amountPaise: result.refundPaise, now });
    return result;
  });

  return { booking: toBookingDto(await loadBooking(id)), cancellation: outcome };
}

// ---- modifying (F13, F14) ---------------------------------------------------------------

/**
 * Changes the dates of a pending or confirmed booking. The same unit is kept when possible.
 * Less than 24 hours before the original start a late fee applies. A higher price creates an
 * adjustment charge to pay, and a lower price is refunded.
 */
export async function modifyBooking(customerId: string, id: string, input: ModifyBookingInput, policy: PolicyService) {
  const now = new Date();
  await expireStaleHolds(now);
  const booking = await loadOwnedBooking(id, customerId);
  if (!isChangeable(booking.status)) throw AppError.conflict('Only pending or confirmed bookings can be modified');

  const settings = settingsOf(policy);
  const window = buildRentalWindow(input.startDate, input.endDate, settings, now);
  if (window.startAt.getTime() === booking.startAt.getTime() && window.endAt.getTime() === booking.endAt.getTime()) {
    throw AppError.badRequest('The dates are unchanged');
  }

  const pct = policyFor(booking, policy).lateCancellationFeePct;
  const newCost = calculateBookingCost(booking.dailyRatePaise, window.days);
  const confirmed = booking.status === 'CONFIRMED';
  const late = confirmed && isLateCancellation(booking.startAt, now);
  const fee = late ? lateCancellationFeePaise(booking.costPaise, pct) : 0;
  const difference = newCost - booking.costPaise;

  const others = (await getBookableUnitIds(booking.unit.equipmentId)).filter((u) => u !== booking.unitId);
  const unitIds = [booking.unitId, ...others];
  const spans = await loadSpans(unitIds, window.startAt, window.endAt, now, booking.id);
  const candidates = freeUnitIds(unitIds, spans, window.startAt, window.endAt);

  for (const unitId of candidates) {
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.booking.updateMany({
          where: { id, status: booking.status },
          data: { unitId, startAt: window.startAt, endAt: window.endAt, rentalDays: window.days, costPaise: newCost },
        });
        if (claimed.count !== 1) throw AppError.conflict('This booking was just changed. Please refresh and try again.');
        await settleModification(tx, { bookingId: id, confirmed, difference, fee, newCost, days: window.days, pct, now, name: booking.unit.equipment.name });
      });
      return toBookingDto(await loadBooking(id));
    } catch (err) {
      if (isOverlapViolation(err)) continue;
      throw err;
    }
  }

  throw noAvailability(await alternativesFor(unitIds, window, input.startDate, settings, now, booking.id));
}

async function settleModification(
  tx: Db,
  m: {
    bookingId: string;
    confirmed: boolean;
    difference: number;
    fee: number;
    newCost: number;
    days: number;
    pct: number;
    now: Date;
    name: string;
  },
) {
  if (!m.confirmed) {
    // Unpaid booking: just update the amount still to be paid.
    await tx.charge.updateMany({
      where: { bookingId: m.bookingId, type: 'BOOKING', status: 'PENDING' },
      data: { amountPaise: m.newCost, description: `${m.name}, ${m.days} day(s)` },
    });
    return;
  }
  if (m.difference > 0) {
    await tx.charge.create({
      data: {
        bookingId: m.bookingId,
        type: 'BOOKING_ADJUSTMENT',
        amountPaise: m.difference,
        description: `Price difference for changed dates (${m.days} day(s))`,
      },
    });
  } else if (m.difference < 0) {
    await issueRefund(tx, { bookingId: m.bookingId, amountPaise: -m.difference, now: m.now });
  }
  if (m.fee > 0) {
    await tx.charge.create({
      data: {
        bookingId: m.bookingId,
        type: 'LATE_CANCELLATION',
        amountPaise: m.fee,
        description: `Late modification fee (${m.pct}% of the original booking cost)`,
        policySnapshot: { lateCancellationFeePct: m.pct },
      },
    });
  }
}

// ---- handover (F12) -------------------------------------------------------------------

/** Staff mark a confirmed booking as picked up: Confirmed becomes Active. */
export async function handoverBooking(staff: Actor, id: string, policy: PolicyService) {
  const now = new Date();
  await expireStaleHolds(now);
  const booking = await loadBooking(id);
  if (booking.status !== 'CONFIRMED') throw AppError.conflict('Only confirmed bookings can be handed over');

  const tz = policy.getSystem().timezone;
  const pickupDayStart = zonedDateTimeToUtc(dateInZone(booking.startAt, tz), '00:00', tz);
  if (now < pickupDayStart) throw AppError.conflict('Handover is only possible from the pickup date');
  if (now >= booking.endAt) throw AppError.conflict('This booking has already ended');
  if (booking.charges.some((c) => c.status === 'PENDING')) {
    throw AppError.conflict('Outstanding charges must be paid before handover');
  }

  if (booking.unit.status !== 'AVAILABLE') {
    // The assigned unit went to maintenance since booking: swap in another free unit if there is one.
    if (!(await reassignBooking(booking.id, now))) {
      throw AppError.conflict('The assigned unit is under maintenance and no other unit is free for these dates');
    }
  }
  
  const claimed = await prisma.booking.updateMany({
    where: { id, status: 'CONFIRMED' },
    data: { status: 'ACTIVE', handedOverAt: now, handedOverById: staff.id },
  });
  if (claimed.count !== 1) throw AppError.conflict('This booking was just changed. Please refresh and try again.');
  return toBookingDto(await loadBooking(id));
}
