import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import type { PolicyService } from '../../config/policy.service.js';
import { getBookingFor } from '../bookings/booking.service.js';
import { reassignUpcoming } from '../bookings/reassign.js';
import { expireStaleHolds } from '../bookings/holds.js';
import { daysLate, lateFeePaise } from '../payments/fees.js';
import { applyLateFee } from '../payments/payments.service.js';
import { formatINR } from '../../lib/money.js';
import {
  conditionLabel,
  damagePenaltyPaise,
  damagePenaltyPct,
  unitOutcome,
  type ConditionName,
} from './returns.rules.js';
import type { ProcessReturnInput } from './returns.schemas.js';

type Staff = { id: string; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' };

const bookingForReturn = {
  unit: { include: { equipment: { include: { category: true } } } },
} as const;

async function loadActiveBooking(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingForReturn });
  if (!booking) throw AppError.notFound('Booking not found');
  if (booking.status !== 'ACTIVE') throw AppError.conflict('Only active bookings can be returned');
  return booking;
}

/** The amounts a return would produce right now (P2: shown to staff before they submit). */
export async function previewReturn(bookingId: string, condition: ConditionName, policy: PolicyService, now = new Date()) {
  const booking = await loadActiveBooking(bookingId);
  const equipment = booking.unit.equipment;
  const rules = policy.getPolicy({ equipmentId: equipment.id, categorySlug: equipment.category.slug });

  const lateDays = daysLate(booking.endAt, now);
  const lateFee = lateFeePaise(rules.lateFeePerDay, lateDays);
  const pct = damagePenaltyPct(condition, rules.damagePenaltyPct);
  const penalty = damagePenaltyPaise(condition, equipment.itemValuePaise, rules.damagePenaltyPct);
  const outcome = unitOutcome({
    condition,
    rentalsSinceMaintenance: booking.unit.rentalsSinceMaintenance + 1,
    intervalRentals: rules.maintenanceIntervalRentals,
  });

  return {
    bookingId,
    dueAt: booking.endAt,
    returnedAt: now,
    daysLate: lateDays,
    lateFeePaise: lateFee,
    damagePenaltyPct: pct,
    itemValuePaise: equipment.itemValuePaise,
    damagePenaltyPaise: penalty,
    totalPaise: lateFee + penalty,
    unitStatusAfter: outcome.status,
    maintenanceTrigger: outcome.trigger,
  };
}

/**
 * Logs the return of an active booking (U3). In one transaction: the booking becomes
 * Completed, the return record is saved, the late fee and damage penalty are created as
 * pending charges, the unit's rental count goes up, and the unit is routed to maintenance
 * or retired when the rules say so. Upcoming bookings on a unit that leaves service are
 * moved to another unit where possible.
 */
export async function processReturn(staff: Staff, input: ProcessReturnInput, policy: PolicyService, now = new Date()) {
  await expireStaleHolds(now);
  const booking = await loadActiveBooking(input.bookingId);
  const equipment = booking.unit.equipment;
  const rules = policy.getPolicy({ equipmentId: equipment.id, categorySlug: equipment.category.slug });

  const lateDays = daysLate(booking.endAt, now);
  const pct = damagePenaltyPct(input.condition, rules.damagePenaltyPct);
  const penalty = damagePenaltyPaise(input.condition, equipment.itemValuePaise, rules.damagePenaltyPct);

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.booking.updateMany({
      where: { id: booking.id, status: 'ACTIVE' },
      data: { status: 'COMPLETED', returnedAt: now },
    });
    if (claimed.count !== 1) throw AppError.conflict('This booking was just changed. Please refresh and try again.');

    await tx.returnRecord.create({
      data: {
        bookingId: booking.id,
        processedById: staff.id,
        condition: input.condition,
        returnedAt: now,
        dueAt: booking.endAt,
        daysLate: lateDays,
        notes: input.notes ?? null,
      },
    });

    const lateCharge = await applyLateFee(booking.id, now, policy, tx);

    let penaltyChargeId: string | null = null;
    if (penalty > 0) {
      const charge = await tx.charge.create({
        data: {
          bookingId: booking.id,
          type: 'DAMAGE_PENALTY',
          amountPaise: penalty,
          description: `${conditionLabel[input.condition]}: ${pct}% of the item value (${formatINR(equipment.itemValuePaise)})`,
          policySnapshot: {
            condition: input.condition,
            damagePenaltyPct: pct,
            itemValuePaise: equipment.itemValuePaise,
          },
        },
      });
      penaltyChargeId = charge.id;
    }

    // F22: count this rental, then decide what happens to the unit (F21, F23).
    const counted = await tx.equipmentUnit.update({
      where: { id: booking.unitId },
      data: { lifetimeRentals: { increment: 1 }, rentalsSinceMaintenance: { increment: 1 } },
    });
    const outcome = unitOutcome({
      condition: input.condition,
      rentalsSinceMaintenance: counted.rentalsSinceMaintenance,
      intervalRentals: rules.maintenanceIntervalRentals,
    });

    if (outcome.status !== 'AVAILABLE') {
      await tx.equipmentUnit.update({
        where: { id: booking.unitId },
        data: {
          status: outcome.status,
          maintenanceDue: outcome.maintenanceDue,
          maintenanceReason: outcome.trigger,
        },
      });
      if (outcome.trigger) {
        await tx.maintenanceLog.create({
          data: {
            unitId: booking.unitId,
            trigger: outcome.trigger,
            notes:
              outcome.trigger === 'DAMAGE'
                ? `${conditionLabel[input.condition]} on return of ${booking.reference}${input.notes ? `: ${input.notes}` : ''}`
                : `Reached ${rules.maintenanceIntervalRentals} rentals since the last maintenance`,
            openedAt: now,
          },
        });
      }
    }

    return { outcome, lateChargeId: lateCharge?.id ?? null, penaltyChargeId };
  });

  // After the commit: move upcoming bookings off a unit that is no longer in service.
  const rebooked =
    result.outcome.status === 'AVAILABLE' ? { moved: 0, stuck: 0 } : await reassignUpcoming(booking.unitId, now);

  return {
    booking: await getBookingFor(staff, booking.id),
    returnRecord: { condition: input.condition, daysLate: lateDays, notes: input.notes ?? null },
    lateFeePaise: lateFeePaise(rules.lateFeePerDay, lateDays),
    damagePenaltyPaise: penalty,
    unit: { tag: booking.unit.tag, status: result.outcome.status, maintenanceTrigger: result.outcome.trigger },
    upcomingBookingsMoved: rebooked.moved,
    upcomingBookingsNeedingAttention: rebooked.stuck,
  };
}
