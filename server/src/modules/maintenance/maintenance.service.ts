import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';

type Staff = { id: string };

const unitInclude = { equipment: { include: { category: true } } } satisfies Prisma.EquipmentUnitInclude;

/** Units waiting for maintenance (F23, F24), with the reason and any upcoming bookings affected. */
async function openQueue(now: Date) {
  const units = await prisma.equipmentUnit.findMany({
    where: { OR: [{ maintenanceDue: true }, { status: 'UNDER_MAINTENANCE' }] },
    include: {
      ...unitInclude,
      logs: { where: { clearedAt: null }, orderBy: { openedAt: 'desc' }, take: 1 },
    },
    orderBy: [{ updatedAt: 'asc' }, { tag: 'asc' }],
  });

  const counts = units.length
    ? await prisma.booking.groupBy({
        by: ['unitId'],
        where: { unitId: { in: units.map((u) => u.id) }, status: { in: ['PENDING', 'CONFIRMED'] }, endAt: { gt: now } },
        _count: { _all: true },
      })
    : [];
  const upcoming = new Map(counts.map((c) => [c.unitId, c._count._all]));

  return units.map((u) => ({
    unitId: u.id,
    tag: u.tag,
    equipmentId: u.equipmentId,
    equipmentName: u.equipment.name,
    category: u.equipment.category.name,
    status: u.status,
    maintenanceDue: u.maintenanceDue,
    reason: u.maintenanceReason,
    notes: u.logs[0]?.notes ?? null,
    openedAt: u.logs[0]?.openedAt ?? null,
    rentalsSinceMaintenance: u.rentalsSinceMaintenance,
    lifetimeRentals: u.lifetimeRentals,
    upcomingBookings: upcoming.get(u.id) ?? 0,
  }));
}

/** Recently cleared maintenance, newest first (supports the maintenance reports). */
async function clearedHistory() {
  const logs = await prisma.maintenanceLog.findMany({
    where: { clearedAt: { not: null } },
    include: { unit: { include: unitInclude }, clearedBy: { select: { name: true } } },
    orderBy: { clearedAt: 'desc' },
    take: 50,
  });
  return logs.map((l) => ({
    logId: l.id,
    unitId: l.unitId,
    tag: l.unit.tag,
    equipmentName: l.unit.equipment.name,
    trigger: l.trigger,
    notes: l.notes,
    openedAt: l.openedAt,
    clearedAt: l.clearedAt,
    clearedBy: l.clearedBy?.name ?? null,
  }));
}

export async function listQueue(view: 'open' | 'cleared') {
  return view === 'open' ? { view, items: await openQueue(new Date()) } : { view, items: await clearedHistory() };
}

/**
 * U6: staff finish maintenance. The flag is cleared, the unit becomes bookable again and its
 * rental counter restarts. Retired units can never be cleared.
 */
export async function clearMaintenance(staff: Staff, unitId: string, notes: string | undefined, now = new Date()) {
  const unit = await prisma.equipmentUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw AppError.notFound('Unit not found');
  if (unit.status === 'RETIRED') throw AppError.conflict('A retired unit cannot be returned to service');
  if (unit.status !== 'UNDER_MAINTENANCE' && !unit.maintenanceDue) {
    throw AppError.conflict('This unit is not in the maintenance queue');
  }

  await prisma.$transaction(async (tx) => {
    const open = await tx.maintenanceLog.findMany({ where: { unitId, clearedAt: null } });
    for (const log of open) {
      await tx.maintenanceLog.update({
        where: { id: log.id },
        data: {
          clearedAt: now,
          clearedById: staff.id,
          notes: [log.notes, notes ? `Cleared: ${notes}` : null].filter(Boolean).join(' | ') || null,
        },
      });
    }
    await tx.equipmentUnit.update({
      where: { id: unitId },
      data: { status: 'AVAILABLE', maintenanceDue: false, maintenanceReason: null, rentalsSinceMaintenance: 0 },
    });
  });

  return { unitId, tag: unit.tag, status: 'AVAILABLE' as const };
}
