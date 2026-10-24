import { prisma } from '../../lib/db.js';

/**
 * Cancels pending bookings whose payment hold has run out and voids their unpaid charges.
 * Pending bookings count toward the database overlap constraint, so expired holds must be
 * cleared or they would block the dates forever. Safe to call at any time.
 */
export async function expireStaleHolds(now: Date = new Date()): Promise<number> {
  const stale = await prisma.booking.findMany({
    where: { status: 'PENDING', holdExpiresAt: { lt: now } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;

  const ids = stale.map((b) => b.id);
  await prisma.$transaction([
    prisma.booking.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: now, holdExpiresAt: null },
    }),
    prisma.charge.updateMany({ where: { bookingId: { in: ids }, status: 'PENDING' }, data: { status: 'VOID' } }),
  ]);
  return ids.length;
}
