import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { freeUnitIds } from './booking.rules.js';

const isOverlapViolation = (err: unknown): boolean =>
  err instanceof Error && /booking_no_overlap|exclusion constraint|23P01/i.test(err.message);

/**
 * Moves one upcoming booking onto another in-service unit of the same equipment that is free
 * for its dates. Returns true when the booking was moved. Used when its unit goes to
 * maintenance or is retired. The database overlap constraint keeps this safe under concurrency.
 */
export async function reassignBooking(bookingId: string, now: Date = new Date()): Promise<boolean> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { unit: true } });
  if (!booking || !['PENDING', 'CONFIRMED'].includes(booking.status)) return false;

  const others = await prisma.equipmentUnit.findMany({
    where: {
      equipmentId: booking.unit.equipmentId,
      id: { not: booking.unitId },
      status: 'AVAILABLE',
      maintenanceDue: false,
    },
    select: { id: true },
    orderBy: [{ lifetimeRentals: 'asc' }, { tag: 'asc' }],
  });
  const unitIds = others.map((u) => u.id);
  if (unitIds.length === 0) return false;

  const spans = await prisma.booking.findMany({
    where: {
      unitId: { in: unitIds },
      startAt: { lt: booking.endAt },
      endAt: { gt: booking.startAt },
      OR: [{ status: { in: ['CONFIRMED', 'ACTIVE'] } }, { status: 'PENDING', holdExpiresAt: { gt: now } }],
    },
    select: { unitId: true, startAt: true, endAt: true },
  });

  for (const unitId of freeUnitIds(unitIds, spans, booking.startAt, booking.endAt)) {
    try {
      await prisma.booking.update({ where: { id: bookingId }, data: { unitId } });
      return true;
    } catch (err) {
      if (isOverlapViolation(err) || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) continue;
      throw err;
    }
  }
  return false;
}

/** Tries to move every upcoming booking off a unit. Returns how many moved and how many could not. */
export async function reassignUpcoming(unitId: string, now: Date = new Date()) {
  const upcoming = await prisma.booking.findMany({
    where: { unitId, status: { in: ['PENDING', 'CONFIRMED'] }, endAt: { gt: now } },
    select: { id: true },
    orderBy: { startAt: 'asc' },
  });
  let moved = 0;
  for (const b of upcoming) {
    if (await reassignBooking(b.id, now)) moved += 1;
  }
  return { moved, stuck: upcoming.length - moved };
}
